// Per-user AI generation + token usage tracking, same flat-JSON-file style as
// users.json / xp-data.json. Appends one record per successful /respond call.
//
// Token counts are an ESTIMATE, not exact usage: the CLI providers (claude,
// grok, agy) return plain text on stdout with no usage/token metadata at
// all, so there's nothing exact to record for them. We approximate using the
// common "~4 chars per token" rule of thumb applied to the input messages and
// the generated response. Good enough to compare relative usage across
// users/time, not for billing-grade accounting.
const { db } = require("./db");
const { readUsers, writeUsers } = require("./auth");

const MAX_AGE_DAYS = 400; // keep a bit over a year of history, then trim
const FREE_TO_BASIC_THRESHOLD = 20; // all-time AI responses generated

function readLog() {
  return db.prepare(`SELECT twitchId, login, provider, ts, tokensIn, tokensOut FROM usage_log ORDER BY ts ASC`).all();
}

const insertEntryStmt = db.prepare(`
  INSERT INTO usage_log (twitchId, login, provider, ts, tokensIn, tokensOut)
  VALUES (@twitchId, @login, @provider, @ts, @tokensIn, @tokensOut)
`);
const deleteOlderThanStmt = db.prepare(`DELETE FROM usage_log WHERE ts < ?`);

function estimateTokens(text) {
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function recordGeneration({ twitchId, login, provider, inputText, outputText }) {
  if (!twitchId) return;
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  deleteOlderThanStmt.run(cutoff);
  insertEntryStmt.run({
    twitchId,
    login: login || null,
    provider: provider || "claude",
    ts: Date.now(),
    tokensIn: estimateTokens(inputText),
    tokensOut: estimateTokens(outputText),
  });
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function startOfWeek(d) {
  const x = new Date(d);
  const dayIdx = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - dayIdx);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function startOfMonth(d) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

// Returns { [twitchId]: { twitchId, login, day, week, month, total,
// tokensDay, tokensWeek, tokensMonth, tokensTotal } } — counts are generation
// counts, tokens* are estimated token totals (input + output).
function getSummary() {
  const entries = readLog();
  const now = Date.now();
  const dayCutoff = startOfDay(now);
  const weekCutoff = startOfWeek(now);
  const monthCutoff = startOfMonth(now);

  const summary = {};
  for (const e of entries) {
    if (!summary[e.twitchId]) {
      summary[e.twitchId] = {
        twitchId: e.twitchId,
        login: e.login,
        day: 0, week: 0, month: 0, total: 0,
        tokensDay: 0, tokensWeek: 0, tokensMonth: 0, tokensTotal: 0,
      };
    }
    const s = summary[e.twitchId];
    const tokens = e.tokensIn + e.tokensOut;
    s.total += 1;
    s.tokensTotal += tokens;
    if (e.ts >= monthCutoff) { s.month += 1; s.tokensMonth += tokens; }
    if (e.ts >= weekCutoff) { s.week += 1; s.tokensWeek += tokens; }
    if (e.ts >= dayCutoff) { s.day += 1; s.tokensDay += tokens; }
    if (e.login) s.login = e.login;
  }
  return summary;
}

// Auto-upgrades a Free-tier user to Basic once they've generated
// FREE_TO_BASIC_THRESHOLD responses all-time. Returns the new tier if an
// upgrade happened, otherwise null.
function maybeAutoUpgradeTier(twitchId) {
  if (!twitchId) return null;
  const users = readUsers();
  const user = users.find((u) => u.twitchId === twitchId);
  if (!user || (user.tier || "pro") !== "free") return null;

  const entries = readLog();
  const total = entries.reduce((n, e) => n + (e.twitchId === twitchId ? 1 : 0), 0);
  if (total < FREE_TO_BASIC_THRESHOLD) return null;

  user.tier = "basic";
  writeUsers(users);
  return "basic";
}

module.exports = { recordGeneration, getSummary, maybeAutoUpgradeTier };
