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

// Scope needed for a separate bot account to post chat messages on the
// streamer's behalf — see connectTwitchForUser() in index.js.
const TWITCH_BOT_SCOPES = "chat:edit";
const BOT_LINK_STATE_COOKIE = "twitch_bot_link_state";
const BOT_LINK_TTL_MS = 10 * 60 * 1000;

// Pending single-use bot-account link requests, keyed by linkToken. Kept
// in-memory (not written to disk like users.json) — short-lived by design,
// and losing pending-but-unfinished links on a restart is harmless; the
// streamer just clicks "Connect my own bot account" again.
const pendingBotLinks = new Map();

function pruneExpiredBotLinks() {
  const now = Date.now();
  for (const [token, entry] of pendingBotLinks) {
    if (now - entry.createdAt > BOT_LINK_TTL_MS) pendingBotLinks.delete(token);
  }
}

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
    tier: "free",
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

// Persist the linked bot account's tokens on the *streamer's* user record
// (a streamer's bot is 1:1 with their own account, not a separate login).
function setBotTwitchTokens(streamerTwitchId, { botTwitchId, botLogin, accessToken, refreshToken, expiresIn }) {
  const users = readUsers();
  const user = users.find((u) => u.twitchId === streamerTwitchId);
  if (!user) return;
  user.botTwitchId = botTwitchId;
  user.botLogin = botLogin;
  user.botAccessTokenEnc = encryptToken(accessToken);
  user.botRefreshTokenEnc = encryptToken(refreshToken);
  user.botTokenExpiresAt = Date.now() + expiresIn * 1000;
  user.botLinkedAt = new Date().toISOString();
  writeUsers(users);
}

function clearBotTwitchTokens(streamerTwitchId) {
  const users = readUsers();
  const user = users.find((u) => u.twitchId === streamerTwitchId);
  if (!user) return;
  delete user.botTwitchId;
  delete user.botLogin;
  delete user.botAccessTokenEnc;
  delete user.botRefreshTokenEnc;
  delete user.botTokenExpiresAt;
  delete user.botLinkedAt;
  writeUsers(users);
}

// Does the actual refresh-token grant and persists the result. Shared by
// getValidBotTwitchToken (proactive, expiry-based) and forceRefreshBotToken
// (reactive, called when Twitch has already rejected the current token —
// its real-world lifetime can be shorter than the expires_in we cached, so
// the IRC client's auth_error is the more reliable signal in practice).
async function refreshBotToken(streamerTwitchId, user) {
  const refreshToken = decryptToken(user.botRefreshTokenEnc);
  if (!refreshToken) return null;

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
    clearBotTwitchTokens(streamerTwitchId);
    throw new Error("BOT_TOKEN_REFRESH_FAILED");
  }
  const data = await res.json();
  setBotTwitchTokens(streamerTwitchId, {
    botTwitchId: user.botTwitchId,
    botLogin: user.botLogin,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
  });
  return { token: data.access_token, username: user.botLogin };
}

// Returns { token, username } for the streamer's linked bot account,
// refreshing first if near expiry, or null if they haven't linked one.
// Throws BOT_TOKEN_REFRESH_FAILED if Twitch has revoked it — callers should
// treat that the same as "not linked" and fall back accordingly.
async function getValidBotTwitchToken(streamerTwitchId) {
  const user = findUser(streamerTwitchId);
  if (!user || !user.botAccessTokenEnc) return null;

  if (Date.now() < user.botTokenExpiresAt - 5 * 60 * 1000) {
    return { token: decryptToken(user.botAccessTokenEnc), username: user.botLogin };
  }

  return refreshBotToken(streamerTwitchId, user);
}

// Unconditionally refreshes the bot token, skipping the cached-expiry check
// — for when Twitch has already rejected the current token (IRC auth_error)
// despite our locally-cached expiresAt saying it should still be valid.
// Returns null if there's nothing to refresh (not linked / no refresh token
// stored), throws BOT_TOKEN_REFRESH_FAILED if Twitch rejects the refresh too
// (revoked bot account) — callers should treat that as "unlinked".
async function forceRefreshBotToken(streamerTwitchId) {
  const user = findUser(streamerTwitchId);
  if (!user || !user.botAccessTokenEnc) return null;
  return refreshBotToken(streamerTwitchId, user);
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

// Stable per-account token for unauthenticated surfaces that can't carry the
// session cookie (OBS Browser Source runs its own CEF instance with no
// access to the streamer's browser cookies). Deterministic from twitchId, so
// it doesn't need its own storage — same idea as the session JWT, but for a
// case where a signed/expiring token would just be an annoyance to re-paste.
function getOverlayToken(twitchId) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(`overlay:${twitchId}`).digest("hex").slice(0, 32);
}

function findUserByOverlayToken(token) {
  if (!token) return null;
  const user = readUsers().find((u) => getOverlayToken(u.twitchId) === token);
  return user && user.approved ? user : null;
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
    // Users created before tiers existed have no `tier` field — default them
    // to "pro" so approval status quo (full access) doesn't change under them.
    tier: user.tier || "pro",
    botLogin: user.botLogin || null,
  });
});

router.post("/auth/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

// ── Bot-account linking ──────────────────────────────────────────────────
// Lets a streamer authorize their *own* bot account (instead of the
// site-wide fallback bot) without ever pasting a token. Two-browser flow:
// the streamer, logged in here, generates a single-use link; they open that
// link in a separate browser/profile logged into the bot's Twitch account,
// which does a normal OAuth consent for chat:edit; the resulting token gets
// attached to the streamer's own user record, and the link is burned.

// POST /bot-link/init — streamer's browser. Creates a single-use link.
router.post("/bot-link/init", requireApprovedUser, (req, res) => {
  pruneExpiredBotLinks();
  const linkToken = crypto.randomBytes(24).toString("hex");
  pendingBotLinks.set(linkToken, {
    streamerTwitchId: req.user.twitchId,
    status: "pending",
    createdAt: Date.now(),
  });
  res.json({
    linkToken,
    url: `${req.protocol}://${req.get("host")}/auth/twitch/bot-link/${linkToken}`,
    expiresInSec: BOT_LINK_TTL_MS / 1000,
  });
});

// GET /bot-link/poll?linkToken=... — streamer's browser polls this while
// waiting for the bot-account browser to finish the OAuth consent.
router.get("/bot-link/poll", requireApprovedUser, (req, res) => {
  pruneExpiredBotLinks();
  const entry = pendingBotLinks.get(req.query.linkToken);
  if (!entry || entry.streamerTwitchId !== req.user.twitchId) {
    return res.json({ status: "expired" });
  }
  res.json({ status: entry.status, botLogin: entry.botLogin || null });
});

// POST /bot-link/cancel — streamer's browser, closing the "waiting" modal early.
router.post("/bot-link/cancel", requireApprovedUser, (req, res) => {
  const entry = pendingBotLinks.get(req.body && req.body.linkToken);
  if (entry && entry.streamerTwitchId === req.user.twitchId) {
    pendingBotLinks.delete(req.body.linkToken);
  }
  res.json({ ok: true });
});

router.post("/bot-link/unlink", requireApprovedUser, (req, res) => {
  clearBotTwitchTokens(req.user.twitchId);
  res.json({ ok: true });
});

// GET /auth/twitch/bot-link/:linkToken — opened in a *separate* browser,
// logged into the bot account. No session/approval check here — this route
// isn't gated by who's logged in, only by knowing the single-use link token.
router.get("/auth/twitch/bot-link/:linkToken", (req, res) => {
  res.set("Cache-Control", "no-store");
  pruneExpiredBotLinks();
  const { linkToken } = req.params;
  const entry = pendingBotLinks.get(linkToken);
  if (!entry || entry.status !== "pending") {
    return res.status(400).send("This bot-account link has expired or was already used. Go back to VTAmigo Settings and generate a new one.");
  }
  const clientId = process.env.TWITCH_CLIENT_ID;
  const redirectUri = process.env.TWITCH_BOT_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return res.status(503).send("Bot-account linking is not configured on this server.");
  }
  res.cookie(BOT_LINK_STATE_COOKIE, linkToken, { httpOnly: true, sameSite: "lax", maxAge: 10 * 60 * 1000 });
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", TWITCH_BOT_SCOPES);
  url.searchParams.set("state", linkToken);
  res.redirect(url.toString());
});

// GET /auth/twitch/bot-callback — Twitch redirects the bot-account browser
// here after consent. Also unauthenticated by session; validated purely via
// the single-use linkToken (state param + cookie, like the main login flow).
router.get("/auth/twitch/bot-callback", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const { code, state } = req.query;
  const expectedState = req.cookies && req.cookies[BOT_LINK_STATE_COOKIE];
  res.clearCookie(BOT_LINK_STATE_COOKIE);
  if (!code || !state || !expectedState || state !== expectedState) {
    return res.status(400).send("Invalid or expired bot-account link — please generate a new one from VTAmigo Settings.");
  }

  pruneExpiredBotLinks();
  const entry = pendingBotLinks.get(state);
  if (!entry || entry.status !== "pending") {
    return res.status(400).send("This bot-account link has expired or was already used. Go back to VTAmigo Settings and generate a new one.");
  }
  // Burn the link immediately so a replayed callback can't reuse it.
  entry.status = "linking";

  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const redirectUri = process.env.TWITCH_BOT_REDIRECT_URI;

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
    const botUser = userData.data && userData.data[0];
    if (!botUser) throw new Error("no user returned by Twitch");

    setBotTwitchTokens(entry.streamerTwitchId, {
      botTwitchId: botUser.id,
      botLogin: botUser.login,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
    });

    entry.status = "linked";
    entry.botLogin = botUser.login;
    sendEvent("bot_link_success", { req, twitchLogin: botUser.login });
    res.send(
      `<!doctype html><meta charset="utf-8"><title>VTAmigo</title>` +
        `<body style="font-family:sans-serif;text-align:center;padding:4rem 1rem">` +
        `<h2>✅ Bot account linked: ${botUser.display_name || botUser.login}</h2>` +
        `<p>You can close this tab and go back to VTAmigo.</p></body>`
    );
  } catch (err) {
    console.error("[auth/twitch/bot-callback]", err.message);
    entry.status = "pending"; // let them retry with the same link rather than stranding it
    res.status(502).send("Bot-account linking failed — please try again from VTAmigo Settings.");
  }
});

module.exports = {
  router,
  requireApprovedUser,
  getApprovedUserFromCookieHeader,
  readUsers,
  writeUsers,
  getValidTwitchToken,
  clearTwitchTokens,
  getOverlayToken,
  findUserByOverlayToken,
  getValidBotTwitchToken,
  forceRefreshBotToken,
  clearBotTwitchTokens,
};
