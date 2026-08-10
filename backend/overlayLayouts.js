// Named layer lists for the custom Overlay Builder (frontend/src/OverlayCanvas.jsx
// -> backend/overlay/custom.html), stored in the overlay_layouts SQLite table
// (see db.js). Unlike chatOverlayConfig.js's single-row-per-account config,
// an account can have several named layouts, so rows are keyed by a
// generated `id` with twitchId as an ownership column, not the primary key.
//
// Layer z-order is simply array order (later = on top) — no separate z field
// to keep in sync when reordering.
const { randomUUID } = require("crypto");
const { db } = require("./db");

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const MAX_LAYERS = 100;

const FONT_FAMILY_RE = /^[\w\s,'"\-]{0,120}$/;
const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

const listStmt = db.prepare(`SELECT id, name, updatedAt FROM overlay_layouts WHERE twitchId = ? ORDER BY updatedAt DESC`);
const getStmt = db.prepare(`SELECT id, twitchId, name, layers, updatedAt FROM overlay_layouts WHERE twitchId = ? AND id = ?`);
const insertStmt = db.prepare(`
  INSERT INTO overlay_layouts (id, twitchId, name, layers, updatedAt) VALUES (@id, @twitchId, @name, @layers, @updatedAt)
`);
const updateStmt = db.prepare(`
  UPDATE overlay_layouts SET name = @name, layers = @layers, updatedAt = @updatedAt WHERE twitchId = @twitchId AND id = @id
`);
const deleteStmt = db.prepare(`DELETE FROM overlay_layouts WHERE twitchId = ? AND id = ?`);

function clampNum(val, min, max, fallback) {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeLayer(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = raw.type;
  if (type !== "image" && type !== "text" && type !== "video") return null;

  const layer = {
    id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 64) : randomUUID(),
    type,
    x: clampNum(raw.x, -CANVAS_W, CANVAS_W * 2, 0),
    y: clampNum(raw.y, -CANVAS_H, CANVAS_H * 2, 0),
    w: clampNum(raw.w, 1, CANVAS_W * 2, 200),
    h: clampNum(raw.h, 1, CANVAS_H * 2, 200),
  };

  if (type === "image" || type === "video") {
    if (typeof raw.assetId !== "string" || !raw.assetId) return null;
    layer.assetId = raw.assetId.slice(0, 64);
  }
  if (type === "image") {
    // CSS filter() HSB adjustment (see OverlayCanvas.jsx/overlay/custom.html)
    // — hue-rotate is a full circle, saturate/brightness are multipliers
    // where 100 = unchanged, 0 = grayscale/black. Opacity is separate (CSS
    // opacity, not a filter), 0-100 where 100 = fully opaque.
    layer.hue = clampNum(raw.hue, -180, 180, 0);
    layer.saturation = clampNum(raw.saturation, 0, 200, 100);
    layer.brightness = clampNum(raw.brightness, 0, 200, 100);
    layer.opacity = clampNum(raw.opacity, 0, 100, 100);
  }
  if (type === "video") {
    layer.loop = raw.loop !== false;
    layer.muted = raw.muted !== false;
  }
  if (type === "text") {
    layer.text = String(raw.text ?? "").slice(0, 500);
    layer.fontSize = clampNum(raw.fontSize, 8, 300, 32);
    const color = String(raw.color ?? "#ffffff");
    layer.color = COLOR_RE.test(color) ? color : "#ffffff";
    const fontFamily = String(raw.fontFamily ?? "").slice(0, 120);
    layer.fontFamily = FONT_FAMILY_RE.test(fontFamily) ? fontFamily : "";
    layer.bold = !!raw.bold;
    layer.align = ["left", "center", "right"].includes(raw.align) ? raw.align : "left";
  }

  return layer;
}

function sanitizeLayers(rawLayers) {
  if (!Array.isArray(rawLayers)) return [];
  return rawLayers.slice(0, MAX_LAYERS).map(sanitizeLayer).filter(Boolean);
}

function rowToSummary(row) {
  return { id: row.id, name: row.name, updatedAt: row.updatedAt };
}

function rowToFull(row) {
  let layers = [];
  try { layers = JSON.parse(row.layers); } catch {}
  return { id: row.id, name: row.name, layers, updatedAt: row.updatedAt };
}

function listLayouts(twitchId) {
  return listStmt.all(twitchId).map(rowToSummary);
}

function createLayout(twitchId, name) {
  const row = {
    id: randomUUID(),
    twitchId,
    name: String(name || "Untitled").slice(0, 80),
    layers: JSON.stringify([]),
    updatedAt: new Date().toISOString(),
  };
  insertStmt.run(row);
  return rowToFull(row);
}

function getLayout(twitchId, id) {
  const row = getStmt.get(twitchId, id);
  return row ? rowToFull(row) : null;
}

// { name?, layers? } — only provided keys are changed.
function updateLayout(twitchId, id, { name, layers } = {}) {
  const existing = getStmt.get(twitchId, id);
  if (!existing) return null;

  const next = {
    id,
    twitchId,
    name: name !== undefined ? String(name).slice(0, 80) : existing.name,
    layers: layers !== undefined ? JSON.stringify(sanitizeLayers(layers)) : existing.layers,
    updatedAt: new Date().toISOString(),
  };
  updateStmt.run(next);
  return rowToFull(next);
}

function deleteLayout(twitchId, id) {
  deleteStmt.run(twitchId, id);
}

// Strips any layer referencing assetId out of every layout owned by twitchId
// — called from overlayAssets.deleteAsset so deleting an in-use asset can't
// leave a layer pointing at a file that no longer exists.
function removeAssetEverywhere(twitchId, assetId) {
  for (const summary of listStmt.all(twitchId)) {
    const row = getStmt.get(twitchId, summary.id);
    if (!row) continue;
    let layers;
    try { layers = JSON.parse(row.layers); } catch { continue; }
    const filtered = layers.filter((l) => l.assetId !== assetId);
    if (filtered.length !== layers.length) {
      updateStmt.run({ id: row.id, twitchId, name: row.name, layers: JSON.stringify(filtered), updatedAt: new Date().toISOString() });
    }
  }
}

module.exports = {
  CANVAS_W, CANVAS_H,
  listLayouts, createLayout, getLayout, updateLayout, deleteLayout, removeAssetEverywhere,
};
