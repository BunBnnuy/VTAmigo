// Twitch OAuth login + session cookies. Approval state lives in users.json,
// a flat JSON file in the same style as .agent-sessions.json / xp-data.json.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { sendEvent } = require("./analytics");

const USERS_PATH = path.join(__dirname, "users.json");
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-insecure-session-secret";
const STATE_COOKIE = "twitch_oauth_state";
const SESSION_COOKIE = "session";

// Scopes needed to read chat and subscribe to EventSub events on the
// logged-in user's own channel — see backend/eventsub.js's subscribeAll().
const TWITCH_LOGIN_SCOPES = [
  "chat:read",
  "channel:read:redemptions",
  "moderator:read:followers",
  "channel:read:subscriptions",
  "bits:read",
].join(" ");

// ── Token encryption at rest (AES-256-GCM, key derived from SESSION_SECRET) ──
// These are live Twitch account tokens, not just session identifiers, so they
// don't belong in users.json as plaintext.
const ENC_KEY = crypto.scryptSync(SESSION_SECRET, "vtamigo-twitch-token", 32);

function encryptToken(plain) {
  if (!plain) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

function decryptToken(encoded) {
  if (!encoded) return null;
  try {
    const buf = Buffer.from(encoded, "base64");
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", ENC_KEY, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function readUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_PATH, "utf8"));
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

function findUser(twitchId) {
  return readUsers().find((u) => u.twitchId === twitchId);
}

function upsertUser(profile) {
  const users = readUsers();
  const existing = users.find((u) => u.twitchId === profile.twitchId);
  if (existing) {
    existing.login = profile.login;
    existing.displayName = profile.displayName;
    existing.profileImageUrl = profile.profileImageUrl;
    writeUsers(users);
    return existing;
  }
  const created = {
    twitchId: profile.twitchId,
    login: profile.login,
    displayName: profile.displayName,
    profileImageUrl: profile.profileImageUrl,
    approved: false,
    createdAt: new Date().toISOString(),
    approvedAt: null,
  };
  users.push(created);
  writeUsers(users);
  return created;
}

// Persist the tokens issued at login/refresh, encrypted at rest.
function setTwitchTokens(twitchId, { accessToken, refreshToken, expiresIn }) {
  const users = readUsers();
  const user = users.find((u) => u.twitchId === twitchId);
  if (!user) return;
  user.twitchAccessTokenEnc = encryptToken(accessToken);
  user.twitchRefreshTokenEnc = encryptToken(refreshToken);
  user.twitchTokenExpiresAt = Date.now() + expiresIn * 1000;
  writeUsers(users);
}

function clearTwitchTokens(twitchId) {
  const users = readUsers();
  const user = users.find((u) => u.twitchId === twitchId);
  if (!user) return;
  delete user.twitchAccessTokenEnc;
  delete user.twitchRefreshTokenEnc;
  delete user.twitchTokenExpiresAt;
  writeUsers(users);
}

// Returns a valid (decrypted, non-expired) Twitch access token for this user,
// refreshing it first if it's within 5 minutes of expiring. Throws if the
// user has no stored token or the refresh fails (e.g. revoked by Twitch) —
// callers should surface this as "log out and back in".
async function getValidTwitchToken(twitchId) {
  const user = findUser(twitchId);
  if (!user || !user.twitchAccessTokenEnc) {
    throw new Error("NO_TWITCH_TOKEN");
  }

  if (Date.now() < user.twitchTokenExpiresAt - 5 * 60 * 1000) {
    return decryptToken(user.twitchAccessTokenEnc);
  }

  const refreshToken = decryptToken(user.twitchRefreshTokenEnc);
  if (!refreshToken) throw new Error("NO_TWITCH_TOKEN");

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    clearTwitchTokens(twitchId);
    throw new Error("TWITCH_TOKEN_REFRESH_FAILED");
  }
  const data = await res.json();
  setTwitchTokens(twitchId, {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
  });
  return data.access_token;
}

function signSession(user) {
  return jwt.sign({ twitchId: user.twitchId }, SESSION_SECRET, { expiresIn: "30d" });
}

function readSession(req) {
  const token = req.cookies && req.cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    const { twitchId } = jwt.verify(token, SESSION_SECRET);
    return findUser(twitchId) || null;
  } catch {
    return null;
  }
}

// Express middleware — 401s unless the session cookie maps to an approved user.
function requireApprovedUser(req, res, next) {
  const user = readSession(req);
  if (!user || !user.approved) return res.status(401).json({ error: "Not authorized" });
  req.user = user;
  next();
}

// Same check for the WS upgrade path, where there's no Express req/res cycle.
function getApprovedUserFromCookieHeader(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const idx = c.indexOf("=");
      return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1).trim())];
    })
  );
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    const { twitchId } = jwt.verify(token, SESSION_SECRET);
    const user = findUser(twitchId);
    return user && user.approved ? user : null;
  } catch {
    return null;
  }
}

const router = express.Router();

router.get("/auth/twitch/login", (req, res) => {
  // This route has a side effect (issues a one-time state cookie) despite
  // being a GET, which makes it a bad target for browser link prefetching —
  // Chrome/Brave can speculatively hit an <a href> on hover, get this
  // Set-Cookie, then discard it (prefetch responses don't commit cookies),
  // while the real click still follows through to Twitch and back with no
  // state cookie to check against. no-store tells the browser not to
  // prefetch/cache this response at all.
  res.set("Cache-Control", "no-store");
  const clientId = process.env.TWITCH_CLIENT_ID;
  const redirectUri = process.env.TWITCH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return res.status(503).send("Twitch OAuth is not configured on this server.");
  }
  sendEvent("login_attempt", { req });
  const state = crypto.randomBytes(16).toString("hex");
  res.cookie(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", maxAge: 5 * 60 * 1000 });
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", TWITCH_LOGIN_SCOPES);
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

router.get("/auth/twitch/callback", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { code, state } = req.query;
  const expectedState = req.cookies && req.cookies[STATE_COOKIE];
  res.clearCookie(STATE_COOKIE);
  if (!code || !state || !expectedState || state !== expectedState) {
    console.error("[auth/twitch/callback] state mismatch", {
      state,
      expectedState,
      cookieHeader: req.headers.cookie,
      allCookies: req.cookies,
    });
    return res.status(400).send("Invalid OAuth state — please try logging in again.");
  }

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const redirectUri = process.env.TWITCH_REDIRECT_URI;

  try {
    const tokenRes = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`);
    const tokenData = await tokenRes.json();

    const userRes = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Client-Id": clientId,
      },
    });
    if (!userRes.ok) throw new Error(`user lookup failed (${userRes.status})`);
    const userData = await userRes.json();
    const twitchUser = userData.data && userData.data[0];
    if (!twitchUser) throw new Error("no user returned by Twitch");

    const user = upsertUser({
      twitchId: twitchUser.id,
      login: twitchUser.login,
      displayName: twitchUser.display_name,
      profileImageUrl: twitchUser.profile_image_url,
    });

    setTwitchTokens(user.twitchId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
    });

    const sessionToken = signSession(user);
    res.cookie(SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    sendEvent("login_success", { req, twitchLogin: user.login });
    res.redirect("/");
  } catch (err) {
    console.error("[auth/twitch/callback]", err.message);
    res.status(502).send("Twitch login failed — please try again.");
  }
});

router.get("/auth/me", (req, res) => {
  const user = readSession(req);
  if (!user) return res.json({ loggedIn: false });
  res.json({
    loggedIn: true,
    approved: user.approved,
    twitchId: user.twitchId,
    login: user.login,
    displayName: user.displayName,
    profileImageUrl: user.profileImageUrl,
  });
});

router.post("/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

module.exports = {
  router,
  requireApprovedUser,
  getApprovedUserFromCookieHeader,
  readUsers,
  writeUsers,
  getValidTwitchToken,
  clearTwitchTokens,
};
