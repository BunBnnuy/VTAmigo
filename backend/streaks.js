// Twitch watch streaks — the "N consecutive streams" notice viewers get in
// chat. Twitch delivers it as IRC USERNOTICE with
//   msg-id=viewermilestone
//   msg-param-category=watch-streak
//   msg-param-value=<consecutive streams>
// (see dev.twitch.tv/docs/irc/tags; the event is not in EventSub for this
// app's scopes — channel.chat.notification would need user:read:chat and
// duplicate the subs/raids we already subscribe to).
//
// This module only normalizes a parsed notice into the single event shape the
// app feed, the Activity Panel and the streak overlay all consume. The socket
// lives in twitch.js and the Helix avatar lookup in sessions.js, so this stays
// pure and trivially testable.
//
// Worth knowing: Twitch only announces milestones (2, 3, 4 and 5+ consecutive
// streams), not every count, and only on monetized channels with Channel
// Points enabled.

const MAX_STREAK = 100000;
const MAX_MESSAGE = 500;
const DEFAULT_COLOR = "#e11d76";

function streakEventFromNotice(notice) {
  if (!notice) return null;
  if (notice.msgId !== "viewermilestone") return null;
  if (notice.category !== "watch-streak") return null;

  const streak = Number(notice.streak);
  if (!Number.isFinite(streak) || streak < 1) return null;

  const username = String(notice.username || notice.login || "").trim();
  if (!username) return null;

  return {
    // msg-param-id is unique per milestone and distinct from the chat message
    // id, so it doubles as the dedupe key in activity.record().
    id: notice.milestoneId || notice.id || `streak-${Date.now()}-${Math.random()}`,
    timestamp: notice.timestamp || Date.now(),
    kind: "streak",
    username,
    color: notice.color || DEFAULT_COLOR,
    streak: Math.min(Math.floor(streak), MAX_STREAK),
    message: String(notice.message || "").slice(0, MAX_MESSAGE),
    userId: notice.userId || null,
    // Filled in by sessions.js after the Helix lookup; null means the overlay
    // draws its initial-letter fallback.
    avatarUrl: null,
  };
}

module.exports = { streakEventFromNotice, MAX_STREAK, MAX_MESSAGE, DEFAULT_COLOR };
