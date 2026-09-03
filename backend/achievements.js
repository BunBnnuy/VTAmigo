// Streamer achievements: milestones for the broadcaster's own account that
// award points, with point thresholds mapping to account tiers
// (free/basic/advanced/pro — see frontend/src/tiers.js).
//
// Design notes, mirroring xp.js / activity.js:
//   • Per-account, keyed by twitchId. Progress is *derived* live from the
//     tables that already track the underlying behaviour (usage_log for AI
//     responses, xp_users for chat volume, activity_events for Twitch events,
//     users.botLogin for the linked bot, avatarOverlay / overlayLayouts /
//     videoQueue for setup milestones) — only the unlock moment is stored,
//     in streamer_achievements (see db.js).
//   • This module is a leaf: it requires db + other leaf modules only, never
//     sessions.js or anything under routes/ (sessions.js requires this file
//     for its chat/event hooks, so the arrow must not point back).
//   • Tier upgrades only ever move upward, never downgrade: an admin tier set
//     via /admin stays until newly-earned points outrank it, at which point
//     the next check lifts it again. The old free -> basic 20-response rule
//     (usage.js) is kept as-is; achievements subsume it (ai_1 + ai_20 alone
//     are worth 25 points, and the basic cutoff is 50).
const { db } = require("./db");
const activity = require("./activity");
const avatarOverlay = require("./avatarOverlay");
const overlayLayouts = require("./overlayLayouts");
const videoQueue = require("./videoQueue");

// Points thresholds for each tier. Fine-tune freely — earnedTierForPoints is
// the only reader, and the frontend renders progress against these same
// values (sent as tierThresholds in the state payload).
const TIER_THRESHOLDS = { free: 0, basic: 50, advanced: 150, pro: 300 };
const TIER_ORDER = ["free", "basic", "advanced", "pro"];

function earnedTierForPoints(points) {
  let earned = "free";
  for (const tier of TIER_ORDER) {
    if (points >= TIER_THRESHOLDS[tier]) earned = tier;
  }
  return earned;
}

// Every achievement: stable id (persisted + used as the i18n key suffix
// `achievementsPanel.items.<id>`), category for panel grouping, point value,
// and a check(stats) predicate. Countable ones carry { target, progressOf }
// so the panel can render a progress bar.
const ACHIEVEMENTS = [
  { id: "first_connect", category: "connection", points: 10, check: (s) => s.connected },
  { id: "ai_1", category: "ai", points: 10, target: 1, progressOf: (s) => s.responses, check: (s) => s.responses >= 1 },
  { id: "ai_20", category: "ai", points: 15, target: 20, progressOf: (s) => s.responses, check: (s) => s.responses >= 20 },
  { id: "ai_100", category: "ai", points: 25, target: 100, progressOf: (s) => s.responses, check: (s) => s.responses >= 100 },
  { id: "ai_500", category: "ai", points: 40, target: 500, progressOf: (s) => s.responses, check: (s) => s.responses >= 500 },
  { id: "chat_100", category: "chat", points: 10, target: 100, progressOf: (s) => s.messages, check: (s) => s.messages >= 100 },
  { id: "chat_1000", category: "chat", points: 20, target: 1000, progressOf: (s) => s.messages, check: (s) => s.messages >= 1000 },
  { id: "chat_10000", category: "chat", points: 30, target: 10000, progressOf: (s) => s.messages, check: (s) => s.messages >= 10000 },
  { id: "community_10", category: "chat", points: 10, target: 10, progressOf: (s) => s.chatters, check: (s) => s.chatters >= 10 },
  { id: "community_50", category: "chat", points: 20, target: 50, progressOf: (s) => s.chatters, check: (s) => s.chatters >= 50 },
  { id: "first_follow", category: "events", points: 15, check: (s) => (s.eventsByKind.follow || 0) > 0 },
  { id: "first_sub", category: "events", points: 15, check: (s) => (s.eventsByKind.sub || 0) > 0 },
  { id: "first_resub", category: "events", points: 15, check: (s) => (s.eventsByKind.resub || 0) > 0 },
  { id: "first_giftsub", category: "events", points: 15, check: (s) => (s.eventsByKind.giftsub || 0) > 0 },
  { id: "first_raid", category: "events", points: 15, check: (s) => (s.eventsByKind.raid || 0) > 0 },
  { id: "first_cheer", category: "events", points: 15, check: (s) => (s.eventsByKind.cheer || 0) > 0 },
  { id: "first_redeem", category: "events", points: 15, check: (s) => (s.eventsByKind.redeem || 0) > 0 },
  { id: "link_bot", category: "setup", points: 20, check: (s) => s.hasBot },
  { id: "avatar_ready", category: "setup", points: 20, check: (s) => s.hasAvatar },
  { id: "overlay_builder", category: "setup", points: 20, check: (s) => s.hasLayout },
  { id: "dj_setup", category: "setup", points: 15, check: (s) => s.hasPlaylist },
];

const DEF_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((d) => [d.id, d]));

const countResponsesStmt = db.prepare(`SELECT COUNT(*) AS n FROM usage_log WHERE twitchId = ?`);
const sumMessagesStmt = db.prepare(`SELECT COALESCE(SUM(messages), 0) AS n FROM xp_users WHERE twitchId = ?`);
const countChattersStmt = db.prepare(`SELECT COUNT(*) AS n FROM xp_users WHERE twitchId = ?`);
const selectUserTierStmt = db.prepare(`SELECT tier, botLogin FROM users WHERE twitchId = ?`);
const updateUserTierStmt = db.prepare(`UPDATE users SET tier = ? WHERE twitchId = ?`);
const selectUnlockedStmt = db.prepare(`SELECT achievementId FROM streamer_achievements WHERE twitchId = ?`);
const insertUnlockStmt = db.prepare(`
  INSERT OR IGNORE INTO streamer_achievements (twitchId, achievementId, unlockedAt)
  VALUES (?, ?, ?)
`);
const deleteAccountAchievementsStmt = db.prepare(`DELETE FROM streamer_achievements WHERE twitchId = ?`);

// Raw counters for one account. `ctx.connectedNow` marks a call that happens
// inside POST /connect (i.e. the account is demonstrably connecting right
// now); otherwise first_connect is inferred retroactively from any prior
// activity, so accounts created before this feature shipped still earn it.
function getStats(twitchId, ctx = {}) {
  let responses = 0;
  let messages = 0;
  let chatters = 0;
  try { responses = countResponsesStmt.get(twitchId).n; } catch {}
  try { messages = sumMessagesStmt.get(twitchId).n; } catch {}
  try { chatters = countChattersStmt.get(twitchId).n; } catch {}

  const eventsByKind = {};
  try {
    for (const event of activity.getRecent(twitchId, 100)) {
      if (event && event.kind) eventsByKind[event.kind] = (eventsByKind[event.kind] || 0) + 1;
    }
  } catch {}

  let hasBot = false;
  try { hasBot = !!selectUserTierStmt.get(twitchId)?.botLogin; } catch {}

  let hasAvatar = false;
  try {
    const status = avatarOverlay.getStatus(twitchId);
    hasAvatar = !!status.hasSpeaking && !!status.hasSilent;
  } catch {}

  let hasLayout = false;
  try { hasLayout = overlayLayouts.listLayouts(twitchId).length > 0; } catch {}

  let hasPlaylist = false;
  try { hasPlaylist = videoQueue.getState(twitchId).defaultPlaylistId != null; } catch {}

  const hasAnyActivity = responses > 0 || messages > 0 || Object.keys(eventsByKind).length > 0;
  return {
    responses, messages, chatters, eventsByKind,
    hasBot, hasAvatar, hasLayout, hasPlaylist,
    connected: !!ctx.connectedNow || hasAnyActivity,
  };
}

function getUnlockedSet(twitchId) {
  try {
    return new Set(selectUnlockedStmt.all(twitchId).map((r) => r.achievementId));
  } catch {
    return new Set();
  }
}

function totalPointsFor(unlockedSet) {
  let total = 0;
  for (const id of unlockedSet) total += DEF_BY_ID[id]?.points || 0;
  return total;
}

function publicDef(def, stats, unlocked) {
  const out = {
    id: def.id,
    category: def.category,
    points: def.points,
    unlocked: unlocked.has(def.id),
  };
  if (def.target) {
    out.target = def.target;
    try {
      out.progress = Math.min(def.progressOf(stats), def.target);
    } catch {
      out.progress = 0;
    }
  } else {
    out.target = 1;
    out.progress = out.unlocked ? 1 : 0;
  }
  return out;
}

// Pure read: full panel state, no writes.
function getState(twitchId, ctx = {}) {
  const stats = getStats(twitchId, ctx);
  const unlocked = getUnlockedSet(twitchId);
  const totalPoints = totalPointsFor(unlocked);
  const earnedTier = earnedTierForPoints(totalPoints);
  return {
    achievements: ACHIEVEMENTS.map((d) => publicDef(d, stats, unlocked)),
    totalPoints,
    earnedTier,
    tierThresholds: { ...TIER_THRESHOLDS },
  };
}

// Check every definition against live stats and persist newly-earned ones.
// Idempotent (INSERT OR IGNORE) — safe to call from hot paths and repeatedly.
function checkAndUnlock(twitchId, ctx = {}) {
  if (!twitchId) return { newlyUnlocked: [], totalPoints: 0, earnedTier: "free" };
  const stats = getStats(twitchId, ctx);
  const unlocked = getUnlockedSet(twitchId);
  const newly = ACHIEVEMENTS.filter((d) => !unlocked.has(d.id) && safeCheck(d, stats));
  if (newly.length > 0) {
    const now = new Date().toISOString();
    const txn = db.transaction((defs) => {
      for (const d of defs) insertUnlockStmt.run(twitchId, d.id, now);
    });
    try {
      txn(newly);
    } catch (err) {
      console.error("[achievements] unlock failed:", err.message);
      return { newlyUnlocked: [], ...stateFrom(stats, unlocked) };
    }
    for (const d of newly) unlocked.add(d.id);
  }
  return {
    newlyUnlocked: newly.map((d) => ({ id: d.id, category: d.category, points: d.points })),
    ...stateFrom(stats, unlocked),
  };
}

function safeCheck(def, stats) {
  try {
    return !!def.check(stats);
  } catch {
    return false;
  }
}

function stateFrom(stats, unlocked) {
  const totalPoints = totalPointsFor(unlocked);
  return { totalPoints, earnedTier: earnedTierForPoints(totalPoints) };
}

// Throttled wrapper for the per-message hot path (sessions.js handleChat):
// at most one real check per account per THROTTLE_MS; anything in between
// returns a throttled marker so callers skip broadcasting. Event/AI/setup
// hooks call checkAndUnlock directly (unthrottled) — they are infrequent.
const THROTTLE_MS = 5000;
const lastCheckByAccount = new Map();

function checkAndUnlockThrottled(twitchId, ctx = {}) {
  const now = Date.now();
  if (now - (lastCheckByAccount.get(twitchId) || 0) < THROTTLE_MS) {
    return { throttled: true, newlyUnlocked: [] };
  }
  lastCheckByAccount.set(twitchId, now);
  return checkAndUnlock(twitchId, ctx);
}

// Lift users.tier to the points-earned tier when it outranks the stored one.
// Upward-only: never downgrades an admin-set tier. Returns the new tier or null.
function maybeUpgradeTier(twitchId, earnedTier) {
  if (!twitchId || !TIER_ORDER.includes(earnedTier)) return null;
  let current = null;
  try {
    current = selectUserTierStmt.get(twitchId)?.tier || "pro";
  } catch {
    return null;
  }
  if (!TIER_ORDER.includes(current)) current = "pro";
  if (TIER_ORDER.indexOf(earnedTier) > TIER_ORDER.indexOf(current)) {
    try {
      updateUserTierStmt.run(earnedTier, twitchId);
    } catch (err) {
      console.error("[achievements] tier upgrade failed:", err.message);
      return null;
    }
    return earnedTier;
  }
  return null;
}

// Test helper: wipe one account's unlocks (memory throttle included).
function reset(twitchId) {
  lastCheckByAccount.delete(twitchId);
  try {
    deleteAccountAchievementsStmt.run(twitchId);
  } catch (err) {
    console.error("[achievements] reset failed:", err.message);
  }
}

module.exports = {
  ACHIEVEMENTS,
  TIER_THRESHOLDS,
  TIER_ORDER,
  earnedTierForPoints,
  getStats,
  getState,
  checkAndUnlock,
  checkAndUnlockThrottled,
  maybeUpgradeTier,
  reset,
};
