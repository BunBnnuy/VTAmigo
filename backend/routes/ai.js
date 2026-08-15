// AI generation + provider memory: POST /respond and the /memory/* family.
//
// Every path here sits under a PROTECTED_PREFIXES entry ("/respond",
// "/memory"), so the blanket requireApprovedUser gate in app.js has already
// populated req.user by the time these handlers run — that gate is registered
// before this router is mounted, and must stay that way.
const express = require("express");
const { sendEvent } = require("../analytics");
const { queryClaudeCLI, importMemory } = require("../claude");
const usage = require("../usage");
const siteConfig = require("../siteConfig");
const memoryExport = require("../memoryExport");
const memoryDownload = require("../memoryDownload");

const router = express.Router();

// POST /respond — run Claude CLI with a batch of messages
router.post("/respond", async (req, res) => {
  const { messages, style, basePrompt, manual } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  // The AI provider is a site-wide admin setting — any provider sent by the
  // client is ignored so a user's own Settings preference can't override it.
  const provider = siteConfig.getProvider();
  const twitchId = req.user?.twitchId;

  sendEvent("ai_response_generated", { req, twitchLogin: req.user?.login, data: { provider } });
  if (manual) sendEvent("now_button_click", { req, twitchLogin: req.user?.login });

  try {
    const response = await queryClaudeCLI(messages, style || "auto", basePrompt || "", null, provider, twitchId);
    usage.recordGeneration({
      twitchId: req.user?.twitchId,
      login: req.user?.login,
      provider,
      inputText: messages.map((m) => m.text || "").join(" "),
      outputText: response,
    });
    const upgradedTier = usage.maybeAutoUpgradeTier(req.user?.twitchId);
    if (upgradedTier) sendEvent("tier_auto_upgraded", { req, twitchLogin: req.user?.login, data: { newTier: upgradedTier } });
    res.json({ response, tier: upgradedTier || undefined });
  } catch (err) {
    if (err.message === "OPENAI_API_KEY_MISSING") {
      return res.status(503).json({ error: "ChatGPT requires OPENAI_API_KEY in the backend environment" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      const name = provider.charAt(0).toUpperCase() + provider.slice(1);
      return res.status(503).json({ error: `${name} CLI not found — make sure it is installed and on your PATH` });
    }
    if (err.message === "TIMEOUT") {
      return res.status(504).json({ error: `${provider} CLI timed out (>60s)` });
    }
    console.error("[ai]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /memory/export — start exporting one provider's session memory to another
router.post("/memory/export", (req, res) => {
  const { from, to } = req.body || {};
  try {
    memoryExport.startExport(from, to, req.user?.twitchId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /memory/export/status — progress of the current/last export job for this account
router.get("/memory/export/status", (req, res) => {
  res.json(memoryExport.getStatus(req.user?.twitchId));
});

// POST /memory/import — load a hand-picked .md file into the site-wide provider's live session
router.post("/memory/import", async (req, res) => {
  const { markdown } = req.body || {};
  const provider = siteConfig.getProvider();
  try {
    const response = await importMemory(markdown, provider, req.user?.twitchId);
    sendEvent("memory_upload", { req, twitchLogin: req.user?.login, data: { provider } });
    res.json({ ok: true, response });
  } catch (err) {
    if (err.message === "MEMORY_EMPTY") {
      return res.status(400).json({ error: "El archivo .md está vacío" });
    }
    if (err.message === "CLI_NOT_FOUND") {
      return res.status(503).json({ error: `${provider} CLI no encontrado` });
    }
    if (err.message === "TIMEOUT") {
      return res.status(504).json({ error: `${provider} CLI tardó demasiado (>60s)` });
    }
    res.status(400).json({ error: err.message });
  }
});

// GET /memory/download/status — when this account's 24h cooldown next clears
router.get("/memory/download/status", (req, res) => {
  res.json(memoryDownload.getStatus(req.user?.twitchId));
});

// POST /memory/download — start a background job dumping the bot's current
// memory as Markdown, gated by a 24h cooldown. Returns immediately; poll
// GET /memory/download/status for progress (the CLI call itself can take a
// couple of minutes, longer than nginx's proxy timeout allows for one request).
router.post("/memory/download", (req, res) => {
  try {
    memoryDownload.startDownload(siteConfig.getProvider(), req.user?.twitchId);
    res.json({ ok: true });
  } catch (err) {
    if (err.message === "COOLDOWN") {
      return res.status(429).json({ error: "COOLDOWN", availableAt: err.availableAt });
    }
    if (err.message === "ALREADY_RUNNING") {
      return res.status(409).json({ error: "Ya hay una descarga en curso" });
    }
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
