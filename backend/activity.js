const https = require("https");
const { db } = require("./db");

// Persists the Activity Panel's feed (follows, subs, raids, cheers, redeems)
// so it survives page reloads/reconnects instead of resetting to empty every
// time the frontend mounts — mirrors xp.js's twitchId-keyed, sqlite-backed pattern.
const KEEP_PER_ACCOUNT = 100;
const BACKFILL_LIMIT = 30;

const insertStmt = db.prepare(`
  INSERT INTO activity_events (id, twitchId, timestamp, event)
  VALUES (@id, @twitchId, @timestamp, @event)
  ON CONFLICT(twitchId, id) DO UPDATE SET timestamp = excluded.timestamp, event = excluded.event
`);
const selectRecentStmt = db.prepare(`
  SELECT event FROM activity_events WHERE twitchId = ? ORDER BY timestamp DESC LIMIT ?
`);
const trimStmt = db.prepare(`
  DELETE FROM activity_events WHERE twitchId = ? AND id NOT IN (
    SELECT id FROM activity_events WHERE twitchId = ? ORDER BY timestamp DESC LIMIT ?
  )
`);
const countStmt = db.prepare(`SELECT COUNT(*) AS n FROM activity_events WHERE twitchId = ?`);

function record(twitchId, event) {
  try {
    insertStmt.run({
      id: String(event.id),
      twitchId,
      timestamp: event.timestamp || Date.now(),
      event: JSON.stringify(event),
    });
    trimStmt.run(twitchId, twitchId, KEEP_PER_ACCOUNT);
  } catch (err) {
    console.error("[activity] record failed:", err.message);
  }
}

function getRecent(twitchId, limit = 30) {
  return selectRecentStmt.all(twitchId, limit)
    .map((row) => JSON.parse(row.event))
    .reverse();
}

function hasAny(twitchId) {
  return countStmt.get(twitchId).n > 0;
}

// { follow: <event>, sub: <event>, ... } — most recent event per kind, for
// the Overlay Builder's {follower.username}-style template tokens (see
// overlayLayouts.js / OverlayCanvas.jsx / overlay/custom.html). Scans the
// same recent-events window rather than a dedicated indexed query since it's
// only ever 100 rows and called on overlay page load / builder mount, not
// per-request-hot-path.
function getLatestByKind(twitchId) {
  const newestFirst = getRecent(twitchId, KEEP_PER_ACCOUNT).slice().reverse();
  const latest = {};
  for (const event of newestFirst) {
    if (!(event.kind in latest)) latest[event.kind] = event;
  }
  return latest;
}

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

function authHeaders(token) {
  return { "Client-ID": process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` };
}

// Twitch's Helix API has no unified activity-history endpoint (that's an
// internal Twitch-dashboard feature, not public) — of the event kinds this
// panel shows, only follows and channel-point redemptions can be recovered
// after the fact. Subs/raids/cheers only ever exist as live EventSub
// notifications, so there's nothing to backfill for those.
async function backfillFollows(twitchId, token) {
  const res = await httpsGet(
    `https://api.twitch.tv/helix/channels/followers?broadcaster_id=${twitchId}&first=${BACKFILL_LIMIT}`,
    authHeaders(token)
  );
  if (res.status !== 200 || !Array.isArray(res.data.data)) return;
  for (const f of res.data.data) {
    record(twitchId, {
      id: `follow-${f.user_id}`,
      timestamp: new Date(f.followed_at).getTime(),
      kind: "follow",
      username: f.user_name || f.user_login,
    });
  }
}

async function backfillRedemptions(twitchId, token) {
  const rewardsRes = await httpsGet(
    `https://api.twitch.tv/helix/channel_points/custom_rewards?broadcaster_id=${twitchId}&only_manageable_rewards=false`,
    authHeaders(token)
  );
  if (rewardsRes.status !== 200 || !Array.isArray(rewardsRes.data.data)) return;

  const redemptions = [];
  for (const reward of rewardsRes.data.data) {
    const res = await httpsGet(
      `https://api.twitch.tv/helix/channel_points/custom_rewards/redemptions?broadcaster_id=${twitchId}&reward_id=${reward.id}&status=FULFILLED&sort=NEWEST&first=${BACKFILL_LIMIT}`,
      authHeaders(token)
    );
    if (res.status === 200 && Array.isArray(res.data.data)) redemptions.push(...res.data.data);
  }

  redemptions
    .sort((a, b) => new Date(b.redeemed_at) - new Date(a.redeemed_at))
    .slice(0, BACKFILL_LIMIT)
    .forEach((r) => {
      record(twitchId, {
        id: `redeem-${r.id}`,
        timestamp: new Date(r.redeemed_at).getTime(),
        kind: "redeem",
        username: r.user_name || r.user_login,
        rewardTitle: r.reward?.title || "",
        text: r.user_input || "",
      });
    });
}

// Best-effort, one-time-per-account backfill of whatever activity history
// Twitch's API can actually still provide — see backfillFollows/Redemptions
// above for why subs/raids/cheers aren't included. Only runs the first time
// an account ever connects (hasAny check), so reconnects don't re-hit the
// API needlessly — record()'s upsert makes re-running harmless either way.
async function backfillIfEmpty(twitchId, token) {
  if (hasAny(twitchId)) return;
  try {
    await Promise.all([backfillFollows(twitchId, token), backfillRedemptions(twitchId, token)]);
  } catch (err) {
    console.error("[activity] backfill failed:", err.message);
  }
}

module.exports = { record, getRecent, getLatestByKind, backfillIfEmpty };
