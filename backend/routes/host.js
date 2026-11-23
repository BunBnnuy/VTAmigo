// Owner-only routes for the autonomous host's live show script.
//
// These are deliberately separate from /respond: generation is a one-off
// background call (a deck every few minutes), while /respond answers chat.
// Both spend provider CLI time, so the same aiLimiter budget applies.
const express = require("express");
const { requireOwner, getValidTwitchToken } = require("../auth");
const streamSettings = require("../streamSettings");
const showScript = require("../showScript");
const { aiLimiter } = require("../rateLimits");

const router = express.Router();

// Prefer Twitch's own view of the stream (title, category, viewers, uptime)
// over whatever the client sent; a stale tab should not make the model write
// about the wrong game. Any Helix failure falls back to the client context.
async function liveContext(req) {
  const body = req.body && typeof req.body.context === "object" ? req.body.context : {};
  const context = { ...body };
  try {
    const token = await getValidTwitchToken(req.user.twitchId);
    const [info, status] = await Promise.all([
      streamSettings.getChannelInfo(token, req.user.twitchId),
      streamSettings.getStreamStatus(token, req.user.twitchId),
    ]);
    if (info) {
      context.title = info.title || context.title;
      context.gameName = info.gameName || context.gameName;
    }
    if (status) {
      if (typeof status.viewerCount === "number") context.viewerCount = status.viewerCount;
      if (status.startedAt) {
        context.uptimeMin = Math.max(0, Math.round((Date.now() - new Date(status.startedAt).getTime()) / 60000));
      }
    }
  } catch {
    /* offline, missing scope or no token: the client context is enough */
  }
  return context;
}

function sendScriptError(res, err) {
  const message = err.message || "";
  if (message === "SCRIPT_BAD_JSON" || message === "SCRIPT_EMPTY") {
    return res.status(502).json({ error: "El modelo no devolvió un guion válido" });
  }
  if (message === "TIMEOUT") return res.status(504).json({ error: "El modelo tardó demasiado" });
  if (message === "CLI_NOT_FOUND") return res.status(503).json({ error: "El CLI del proveedor no está instalado" });
  if (message.startsWith("SCRIPT_CLI:")) return res.status(502).json({ error: message.slice(11).trim() });
  console.error("[host/script]", message);
  return res.status(500).json({ error: message });
}

// GET /host/script — newest decks (with their beats) for this account.
router.get("/host/script", requireOwner, (req, res) => {
  res.json({ decks: showScript.listDecks(req.user.twitchId) });
});

// POST /host/script — generate one deck now. Called manually from the panel
// and automatically by the client when the current decks run low.
router.post("/host/script", requireOwner, aiLimiter, async (req, res) => {
  try {
    const context = await liveContext(req);
    const { language, count } = req.body || {};
    const deck = await showScript.generateDeck(req.user.twitchId, {
      context,
      language: typeof language === "string" ? language : "es",
      count: Number(count) || 14,
    });
    res.json({ deck });
  } catch (err) {
    sendScriptError(res, err);
  }
});

// POST /host/script/used — { deckId, beatId }. Idempotent: a beat already
// marked used answers 404, which the client treats as "someone else got it".
router.post("/host/script/used", requireOwner, (req, res) => {
  const { deckId, beatId, text } = req.body || {};
  const ok = showScript.markUsed(req.user.twitchId, { deckId, beatId, text });
  if (!ok) return res.status(404).json({ error: "Beat not found" });
  res.json({ ok: true });
});

// POST /host/script/:id/discard — drop a deck that no longer fits the stream.
router.post("/host/script/:id/discard", requireOwner, (req, res) => {
  const ok = showScript.discardDeck(req.user.twitchId, req.params.id);
  if (!ok) return res.status(404).json({ error: "Deck not found" });
  res.json({ ok: true });
});

module.exports = router;
