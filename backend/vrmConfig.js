// Per-account configuration for the VRM overlay page (vrm-overlay.html) and the
// lab that feeds it. Kept out of user_settings on purpose: the app syncs that
// whole localStorage blob on login, so lab-only keys there get overwritten.
const { db } = require("./db");

const getStmt = db.prepare(
  `SELECT modelUrl, idleClip, autoClips, varyIdle, updatedAt FROM vrm_config WHERE twitchId = ?`
);
const upsertStmt = db.prepare(`
  INSERT INTO vrm_config (twitchId, modelUrl, idleClip, autoClips, varyIdle, updatedAt)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(twitchId) DO UPDATE SET
    modelUrl = excluded.modelUrl,
    idleClip = excluded.idleClip,
    autoClips = excluded.autoClips,
    varyIdle = excluded.varyIdle,
    updatedAt = excluded.updatedAt
`);

const DEFAULTS = { modelUrl: "", idleClip: "", autoClips: true, varyIdle: false };
const MAX_URL = 2048;

function normalizeModelUrl(value) {
  if (typeof value !== "string") return "";
  const url = value.trim();
  if (!url) return "";
  if (url.length > MAX_URL) throw new Error("modelUrl is too long");
  // http(s) for a hosted model, or a same-origin path served by this app.
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) {
    throw new Error("modelUrl must be an http(s) URL or a path starting with /");
  }
  return url;
}

function normalizeIdleClip(value) {
  if (typeof value !== "string") return "";
  const id = value.trim();
  if (!/^[a-z0-9_-]{0,64}$/i.test(id)) throw new Error("invalid idleClip");
  return id;
}

function get(twitchId) {
  const row = getStmt.get(twitchId);
  if (!row) return { ...DEFAULTS };
  return {
    modelUrl: row.modelUrl || "",
    idleClip: row.idleClip || "",
    autoClips: !!row.autoClips,
    varyIdle: !!row.varyIdle,
    updatedAt: row.updatedAt || null,
  };
}

// Partial update: only the keys present in `patch` change.
function save(twitchId, patch = {}) {
  const current = get(twitchId);
  const next = {
    modelUrl: Object.prototype.hasOwnProperty.call(patch, "modelUrl")
      ? normalizeModelUrl(patch.modelUrl)
      : current.modelUrl,
    idleClip: Object.prototype.hasOwnProperty.call(patch, "idleClip")
      ? normalizeIdleClip(patch.idleClip)
      : current.idleClip,
    autoClips: Object.prototype.hasOwnProperty.call(patch, "autoClips")
      ? !!patch.autoClips
      : current.autoClips,
    varyIdle: Object.prototype.hasOwnProperty.call(patch, "varyIdle")
      ? !!patch.varyIdle
      : current.varyIdle,
  };
  upsertStmt.run(
    twitchId,
    next.modelUrl,
    next.idleClip,
    next.autoClips ? 1 : 0,
    next.varyIdle ? 1 : 0,
    new Date().toISOString()
  );
  return get(twitchId);
}

module.exports = { get, save, DEFAULTS };
