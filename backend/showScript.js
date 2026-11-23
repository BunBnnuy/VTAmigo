// Live show-script decks for the owner-only autonomous host.
//
// The bot must be able to run a 12-hour stream without a human, so a single
// "deck" is not enough: decks are generated in a rolling loop while live (the
// client asks for a new one when few beats are left) and the playout speaks
// one beat per silence. This module owns the durable half:
//
//   • generateDeck()  — one CLI call → validated beats → show_scripts row.
//   • listDecks()     — the newest decks, with their unused beats.
//   • markUsed()      — remembers a spoken beat in show_script_history so the
//                       next deck cannot repeat it.
//   • parseDeck()     — pure validation/dedupe, exported for tests.
//
// The model never gets to invent stream facts: the prompt carries only the
// context the route supplied (Twitch title/category, uptime, now playing,
// recent chat, the streamer's topic bank) and the parser drops anything that
// looks like markdown/URLs or duplicates a recent beat.
const crypto = require("crypto");
const { db } = require("./db");
const { runCLI } = require("./ai/runner");
const { buildScriptPrompt, SCRIPT_KINDS } = require("./ai/prompt");
const siteConfig = require("./siteConfig");

const KINDS = new Set(SCRIPT_KINDS);
const MAX_DECKS = 72; // ~12 h at one deck every ~10 min, kept for history marking
const HISTORY_DAYS = 30;
const HISTORY_MAX = 1200;
const MAX_BEATS_PER_DECK = 20;

const insertDeckStmt = db.prepare(
  `INSERT INTO show_scripts (id, twitchId, createdAt, beats, meta) VALUES (?, ?, ?, ?, ?)`
);
const listDecksStmt = db.prepare(
  `SELECT id, createdAt, beats, meta FROM show_scripts
   WHERE twitchId = ? ORDER BY createdAt DESC LIMIT ?`
);
const getDeckStmt = db.prepare(
  `SELECT id, twitchId, createdAt, beats, meta FROM show_scripts WHERE id = ? AND twitchId = ?`
);
const updateBeatsStmt = db.prepare(`UPDATE show_scripts SET beats = ? WHERE id = ? AND twitchId = ?`);
const deleteDeckStmt = db.prepare(`DELETE FROM show_scripts WHERE id = ? AND twitchId = ?`);
const pruneDecksStmt = db.prepare(
  `DELETE FROM show_scripts WHERE twitchId = ? AND id NOT IN (
     SELECT id FROM show_scripts WHERE twitchId = ? ORDER BY createdAt DESC LIMIT ${MAX_DECKS}
   )`
);
const historyStmt = db.prepare(
  `SELECT text FROM show_script_history WHERE twitchId = ? ORDER BY usedAt DESC LIMIT ?`
);
const insertHistoryStmt = db.prepare(
  `INSERT INTO show_script_history (twitchId, textHash, text, usedAt) VALUES (?, ?, ?, ?)
   ON CONFLICT(twitchId, textHash) DO UPDATE SET usedAt = excluded.usedAt`
);
const pruneHistoryAgeStmt = db.prepare(
  `DELETE FROM show_script_history WHERE twitchId = ? AND usedAt < ?`
);
const pruneHistoryCountStmt = db.prepare(
  `DELETE FROM show_script_history WHERE twitchId = ? AND rowid NOT IN (
     SELECT rowid FROM show_script_history WHERE twitchId = ? ORDER BY usedAt DESC LIMIT ${HISTORY_MAX}
   )`
);

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

// Accent/punctuation-insensitive form used for hashing and similarity.
function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashText(value) {
  return crypto.createHash("sha256").update(normalizeText(value)).digest("hex").slice(0, 32);
}

function shingles(value) {
  const words = normalizeText(value).split(" ").filter(Boolean);
  if (words.length < 3) return new Set(words);
  const out = new Set();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

function similarity(a, b) {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length > 20 && nb.length > 20 && (na.includes(nb) || nb.includes(na))) return 0.9;
  const sa = shingles(a);
  const sb = shingles(b);
  if (!sa.size || !sb.size) return 0;
  let shared = 0;
  for (const s of sa) if (sb.has(s)) shared++;
  return shared / (sa.size + sb.size - shared);
}

function isDuplicate(text, others, threshold = 0.72) {
  return others.some((other) => similarity(text, other) >= threshold);
}

// The model is useful but unreliable about format. This is the only gate
// between its raw stdout and a deck that gets spoken on stream.
function parseDeck(raw, { avoid = [] } = {}) {
  let text = String(raw || "").trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("SCRIPT_BAD_JSON");

  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("SCRIPT_BAD_JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("SCRIPT_BAD_JSON");

  const seen = [];
  const beats = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const kind = String(item.kind || "").trim().toLowerCase();
    if (!KINDS.has(kind)) continue;

    let body = String(item.text || "").replace(/\s+/g, " ").trim();
    // TTS reads this aloud and it is also posted to chat: strip anything that
    // renders as markup, leaks a URL, or is simply too long/short to be a line.
    if (body.length < 12 || body.length > 240) continue;
    if (/https?:\/\//i.test(body)) continue;
    if (/[*_#`<>]/.test(body)) continue;
    if (isDuplicate(body, [...avoid, ...seen])) continue;

    const afterMin = clampInt(item.afterMin, 0, 30, 0);
    let beforeMin = clampInt(item.beforeMin, 0, 90, 0);
    if (beforeMin && beforeMin <= afterMin) beforeMin = Math.min(90, afterMin + 20);

    beats.push({
      id: crypto.randomUUID(),
      kind,
      text: body,
      afterMin,
      beforeMin,
    });
    seen.push(body);
    if (beats.length >= MAX_BEATS_PER_DECK) break;
  }
  return beats;
}

function recentHistory(twitchId, limit = 40) {
  return historyStmt.all(twitchId, clampInt(limit, 1, 200, 40)).map((row) => row.text);
}

function pruneHistory(twitchId) {
  pruneHistoryAgeStmt.run(twitchId, Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  pruneHistoryCountStmt.run(twitchId, twitchId);
}

function listDecks(twitchId, limit = 8) {
  return listDecksStmt.all(twitchId, clampInt(limit, 1, MAX_DECKS, 8)).flatMap((row) => {
    let beats;
    try {
      beats = JSON.parse(row.beats);
    } catch {
      return [];
    }
    if (!Array.isArray(beats)) return [];
    let meta = null;
    try {
      meta = row.meta ? JSON.parse(row.meta) : null;
    } catch {
      /* meta is advisory only */
    }
    return [{ id: row.id, createdAt: row.createdAt, beats, meta }];
  });
}

async function generateDeck(twitchId, { context = {}, language = "es", count = 14 } = {}) {
  const provider = siteConfig.getProvider();
  const model = siteConfig.getModel(provider);
  const beatCount = clampInt(count, 6, MAX_BEATS_PER_DECK, 14);
  const avoid = recentHistory(twitchId, 40);
  const prompt = buildScriptPrompt(
    { ...context, avoid: [...avoid, ...(Array.isArray(context.avoid) ? context.avoid : [])] },
    { count: beatCount, language }
  );

  let raw;
  try {
    raw = await runCLI(prompt, { provider, twitchId, model, session: false, timeoutMs: 90000 });
  } catch (err) {
    if (err.message === "CLI_NOT_FOUND" || err.message === "TIMEOUT") throw err;
    throw new Error(`SCRIPT_CLI: ${err.message}`);
  }

  const beats = parseDeck(raw, { avoid });
  if (beats.length < 3) throw new Error("SCRIPT_EMPTY");

  const id = crypto.randomUUID();
  const createdAt = Date.now();
  const meta = {
    language,
    count: beatCount,
    provider,
    // Snapshot of what the model was told, for debugging a weird deck.
    title: context.title || "",
    gameName: context.gameName || "",
    uptimeMin: Number(context.uptimeMin) || 0,
  };
  insertDeckStmt.run(id, twitchId, createdAt, JSON.stringify(beats), JSON.stringify(meta));
  pruneDecksStmt.run(twitchId, twitchId);

  return { id, createdAt, beats, meta };
}

function markUsed(twitchId, { deckId, beatId, text } = {}) {
  const row = getDeckStmt.get(deckId, twitchId);
  if (!row) return false;
  let beats;
  try {
    beats = JSON.parse(row.beats);
  } catch {
    return false;
  }
  if (!Array.isArray(beats)) return false;

  const beat = beatId
    ? beats.find((b) => b.id === beatId)
    : beats.find((b) => normalizeText(b.text) === normalizeText(text));
  if (!beat || beat.usedAt) return false;

  const now = Date.now();
  beat.usedAt = now;
  updateBeatsStmt.run(JSON.stringify(beats), deckId, twitchId);
  insertHistoryStmt.run(twitchId, hashText(beat.text), beat.text, now);
  pruneHistory(twitchId);
  return true;
}

function discardDeck(twitchId, deckId) {
  return deleteDeckStmt.run(deckId, twitchId).changes > 0;
}

module.exports = {
  generateDeck,
  listDecks,
  markUsed,
  discardDeck,
  parseDeck,
  normalizeText,
  similarity,
  isDuplicate,
  recentHistory,
};
