// Twitch "Modify Channel Information" / "Search Categories" Helix calls, for
// the Stream Settings panel (title + category). Kept separate from
// eventsub.js's Helix helpers since this is a different concern (on-demand
// user action, not the persistent EventSub connection) — mirrors its
// httpsGet/httpsPost shape rather than importing it, matching how the rest
// of backend/ keeps each file self-contained.
const https = require("https");

function httpsGet(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on("error", reject);
  });
}

function httpsPatch(url, headers, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const urlObj = new URL(url);
    const req = https.request(
      {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, data }); }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// A 401/403 here almost always means the stored token predates the
// channel:manage:broadcast scope being added to TWITCH_LOGIN_SCOPES — the
// caller should tell the user to log out and back in rather than treating
// it as a generic failure.
function scopeError() {
  return Object.assign(new Error("Missing Twitch scope: channel:manage:broadcast"), {
    code: "MISSING_SCOPE",
  });
}

function authHeaders(token) {
  return { "Client-ID": process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` };
}

async function searchCategories(token, query) {
  const res = await httpsGet(
    `https://api.twitch.tv/helix/search/categories?first=10&query=${encodeURIComponent(query)}`,
    authHeaders(token)
  );
  if (res.status === 401 || res.status === 403) throw scopeError();
  if (res.status !== 200) {
    throw new Error(`Twitch search/categories failed (HTTP ${res.status})`);
  }
  return (res.data.data || []).map((c) => ({
    id: c.id,
    name: c.name,
    boxArtUrl: c.box_art_url,
  }));
}

async function getChannelInfo(token, broadcasterId) {
  const res = await httpsGet(
    `https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`,
    authHeaders(token)
  );
  if (res.status === 401 || res.status === 403) throw scopeError();
  if (res.status !== 200 || !res.data.data?.length) {
    throw new Error(`Twitch channels lookup failed (HTTP ${res.status})`);
  }
  const c = res.data.data[0];
  return { title: c.title, gameId: c.game_id, gameName: c.game_name };
}

// { title, gameId } — only the keys actually passed in are sent, since Helix
// treats an absent key as "leave unchanged" (an explicit "" is still sent).
async function updateChannelInfo(token, broadcasterId, { title, gameId } = {}) {
  const body = {};
  if (title !== undefined) body.title = title;
  if (gameId !== undefined) body.game_id = gameId;

  const res = await httpsPatch(
    `https://api.twitch.tv/helix/channels?broadcaster_id=${broadcasterId}`,
    authHeaders(token),
    body
  );
  if (res.status === 401 || res.status === 403) throw scopeError();
  if (res.status !== 204) {
    throw new Error(`Twitch channels update failed (HTTP ${res.status})`);
  }
}

module.exports = { searchCategories, getChannelInfo, updateChannelInfo };
