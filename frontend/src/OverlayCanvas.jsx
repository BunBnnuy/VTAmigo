import React, { useState, useEffect, useRef, useCallback } from "react";
import { Rnd } from "react-rnd";
import { apiFetch, apiUrl } from "./api.js";
import {
  Volume2,
  Image as ImageIcon,
  Film,
  Type,
  PanelsTopLeft,
  ArrowDown,
  ArrowUp,
  Trash2,
  Check,
  X,
  EyeOff,
  Crosshair,
  Minus,
  Plus,
  GripVertical,
  Pencil,
  Images,
} from "lucide-react";

const CANVAS_W = 1920;
const CANVAS_H = 1080;
// Extra pasteboard (in canvas px) around the artboard. Layers are free to be
// dragged past the canvas edge (OBS clips at the 1920x1080 boundary, so this
// is purely a design surface) and this margin gives that off-canvas space a
// visible area to land in instead of dropping into the void. Kept small so
// the artboard itself still gets most of the viewport; the zoom controls let
// the pasteboard be inspected when needed.
const WORKSPACE_MARGIN = 200;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.25;
const SAVE_DEBOUNCE_MS = 800;
// Mirrors overlayAssets.MAX_ASSET_BYTES on the backend. Checked here first so
// an oversized file gets a clear message instead of waiting for the upload to
// fail at the request-body limit ("Request body too large").
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_LABEL = `${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`;

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatBytes(n) {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Template tokens usable in any text layer's content, e.g. "{follower.username}
// just followed!" — filled live from the most recent event of that kind (see
// backend/activity.js's getLatestByKind), both here for the editor preview
// and in overlay/custom.html (same TOKEN_TO_KIND map, kept in sync by hand
// since the OBS-facing page is a separate static-HTML bundle, not React).
const TOKEN_TO_KIND = { follower: "follow", sub: "sub", resub: "resub", giftsub: "giftsub", raid: "raid", cheer: "cheer", redeem: "redeem" };
const TOKEN_INSERT_BUTTONS = [
  { label: "Follower", token: "{follower.username}" },
  { label: "Sub", token: "{sub.username}" },
  { label: "Resub", token: "{resub.username}" },
  { label: "Gift Sub", token: "{giftsub.username}" },
  { label: "Raid", token: "{raid.username}" },
  { label: "Cheer", token: "{cheer.username}" },
  { label: "Redeem", token: "{redeem.username}" },
];
const TOKEN_HINT = "Other fields: {sub.tier} {resub.months} {giftsub.count} {raid.viewers} {cheer.bits} {redeem.rewardTitle}";

// Replaces every {namespace.field} token with the matching field off the
// latest event of that kind — e.g. {cheer.bits} -> latestByKind.cheer.bits.
// Left as-is (still showing the raw token) when there's no event yet, so an
// unconfigured/empty overlay reads as "waiting for data" rather than blank.
function fillTemplate(template, latestByKind) {
  return template.replace(/\{(\w+)\.(\w+)\}/g, (match, ns, field) => {
    const kind = TOKEN_TO_KIND[ns];
    const event = kind && latestByKind && latestByKind[kind];
    return event && event[field] !== undefined ? String(event[field]) : match;
  });
}

// CSS filter() HSB adjustment for image layers — hue-rotate is a full circle
// (-180..180deg both mean the same as 180), saturate/brightness are percent
// multipliers where 100 = unchanged. Kept in sync by hand with the identical
// helper in overlay/custom.html (separate static-HTML bundle, not React).
function hsbFilter(layer) {
  const hue = layer.hue || 0;
  const saturation = layer.saturation ?? 100;
  const brightness = layer.brightness ?? 100;
  if (hue === 0 && saturation === 100 && brightness === 100) return undefined;
  return `hue-rotate(${hue}deg) saturate(${saturation}%) brightness(${brightness}%)`;
}

// The editor for one layout: a 1920x1080 transparent canvas (react-rnd
// layers, scaled to fit the viewport), a toolbar to add image/text/video
// layers, a property panel for the selected layer, and a media-library
// sidebar of this account's uploaded assets. Changes autosave (debounced)
// via PUT /overlay-builder/layouts/:id, which also broadcasts the update to
// any open OBS view over the /chat WS — see backend/overlay/custom.html.
//
// brandSlot/headerControls are rendered by OverlayBuilder and placed at the
// two ends of this component's single header bar, so the layout picker and
// page actions share one row with the add-layer buttons instead of stacking
// a second full-width toolbar underneath.
export default function OverlayCanvas({ layoutId, latestByKind, brandSlot, headerControls }) {
  const [layers, setLayers] = useState([]);
  const [assets, setAssets] = useState([]);
  const [usageBytes, setUsageBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(100 * 1024 * 1024);
  const [token, setToken] = useState("");
  const [overlaySources, setOverlaySources] = useState([]);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [fitScale, setFitScale] = useState(0.25);
  // Multiplier on top of the auto-fit scale — 1 = fit the whole workspace in
  // the viewport, >1 lets the canvas overflow and be scrolled.
  const [zoomFactor, setZoomFactor] = useState(1);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [deleteArmedAssetId, setDeleteArmedAssetId] = useState(null);
  const [mediaOpen, setMediaOpen] = useState(false);

  const viewportRef = useRef(null);
  const saveTimerRef = useRef(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const scale = fitScale * zoomFactor;

  const refreshAssets = useCallback(() => {
    apiFetch("/overlay-builder/assets").then((r) => r.json()).then((data) => {
      setAssets(data.assets || []);
      setUsageBytes(data.usageBytes || 0);
      if (data.quotaBytes) setQuotaBytes(data.quotaBytes);
    });
  }, []);

  const refreshLayout = useCallback(() => {
    apiFetch(`/overlay-builder/layouts/${layoutId}`).then((r) => r.json()).then((data) => {
      if (data.layout) setLayers(data.layout.layers);
    });
  }, [layoutId]);

  useEffect(() => {
    refreshLayout();
    refreshAssets();
    apiFetch("/overlay-builder/sources")
      .then((r) => r.json())
      .then((data) => setOverlaySources(data.sources || []));
    apiFetch(`/overlay-builder/overlay-url/${layoutId}`)
      .then((r) => r.json())
      .then((data) => setToken(data.token || ""));
  }, [layoutId, refreshLayout, refreshAssets]);

  // Scale the canvas to fit whatever space the viewport has, preserving the
  // 16:9 aspect ratio — react-rnd's `scale` prop keeps drag/resize math
  // correct under this CSS transform.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const compute = () => {
      const availW = el.clientWidth - 40;
      const availH = el.clientHeight - 40;
      const totalW = CANVAS_W + WORKSPACE_MARGIN * 2;
      const totalH = CANVAS_H + WORKSPACE_MARGIN * 2;
      setFitScale(Math.max(0.05, Math.min(availW / totalW, availH / totalH)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scheduleSave = useCallback(() => {
    setSaveState("saving");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      await apiFetch(`/overlay-builder/layouts/${layoutId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layers: layersRef.current }),
      });
      setSaveState("saved");
    }, SAVE_DEBOUNCE_MS);
  }, [layoutId]);

  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  useEffect(() => {
    if (!errorMsg) return;
    const timer = setTimeout(() => setErrorMsg(""), 4000);
    return () => clearTimeout(timer);
  }, [errorMsg]);

  const updateLayer = (id, patch) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    scheduleSave();
  };

  const addLayer = (layer) => {
    setLayers((prev) => [...prev, layer]);
    setSelectedLayerId(layer.id);
    scheduleSave();
  };

  const removeLayer = (id) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setSelectedLayerId((cur) => (cur === id ? null : cur));
    scheduleSave();
  };

  const reorderLayer = (id, dir) => {
    setLayers((prev) => {
      const idx = prev.findIndex((l) => l.id === id);
      if (idx === -1) return prev;
      const next = prev.slice();
      const [item] = next.splice(idx, 1);
      if (dir === "front") next.push(item);
      else next.unshift(item);
      return next;
    });
    scheduleSave();
  };

  const renameLayer = (id, name) => updateLayer(id, { name });

  // Called by the Layers panel with ids in DISPLAY order (topmost first);
  // the stored array is bottom-first paint order, hence the reverse.
  const reorderLayers = (orderedIds) => {
    setLayers((prev) => {
      const byId = new Map(prev.map((l) => [l.id, l]));
      const next = orderedIds.slice().reverse().map((id) => byId.get(id)).filter(Boolean);
      // Defensive: keep any layer the list didn't know about, at the back.
      const missing = prev.filter((l) => !orderedIds.includes(l.id));
      return [...missing, ...next];
    });
    scheduleSave();
  };

  const uploadImage = (file) => {
    if (file.size > MAX_UPLOAD_BYTES) return setErrorMsg(`Image must be under ${MAX_UPLOAD_LABEL}`);
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiFetch("/overlay-builder/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl: reader.result, name: file.name }),
        });
        const data = await res.json();
        if (!res.ok) return setErrorMsg(data.error || "Upload failed");
        refreshAssets();
        addLayer({ id: uid(), type: "image", assetId: data.asset.id, x: 100, y: 100, w: 480, h: 320 });
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const uploadVideo = async (file) => {
    if (file.size > MAX_UPLOAD_BYTES) return setErrorMsg(`Video must be under ${MAX_UPLOAD_LABEL}`);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("video", file);
      const res = await apiFetch("/overlay-builder/assets/video", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) return setErrorMsg(data.error || "Upload failed");
      refreshAssets();
      addLayer({
        id: uid(), type: "video", assetId: data.asset.id, muted: false, x: 100, y: 100, w: 640, h: 360,
        autoplay: false, playMode: "loop", randomPosition: false,
        triggerEnabled: false, triggerType: "command", triggerValue: "", minRole: "everyone",
      });
    } finally {
      setUploading(false);
    }
  };

  const uploadAudio = async (file) => {
    if (file.size > MAX_UPLOAD_BYTES) return setErrorMsg(`Audio must be under ${MAX_UPLOAD_LABEL}`);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("audio", file);
      const res = await apiFetch("/overlay-builder/assets/audio", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) return setErrorMsg(data.error || "Upload failed");
      refreshAssets();
      addLayer({
        id: uid(), type: "sound", assetId: data.asset.id, volume: 100, x: 100, y: 100, w: 120, h: 120,
        autoplay: false, playMode: "loop",
        triggerEnabled: false, triggerType: "command", triggerValue: "", minRole: "everyone",
      });
    } finally {
      setUploading(false);
    }
  };

  const addText = () => {
    addLayer({ id: uid(), type: "text", text: "New Text", fontSize: 48, color: "#ffffff", bold: false, align: "left", x: 100, y: 100, w: 500, h: 100 });
  };

  const addOverlay = (sourceId) => {
    const source = overlaySources.find((item) => item.id === sourceId);
    if (!source) return;
    addLayer({ id: uid(), type: "overlay", sourceId, x: 100, y: 100, w: source.w, h: source.h });
  };

  const deleteAsset = async (assetId) => {
    if (deleteArmedAssetId !== assetId) { setDeleteArmedAssetId(assetId); return; }
    setDeleteArmedAssetId(null);
    await apiFetch(`/overlay-builder/assets/${assetId}`, { method: "DELETE" });
    refreshAssets();
    refreshLayout();
  };

  // Renaming is metadata only — the manifest entry keeps its id/ext, so every
  // layer already using the asset picks up the new name in the Layers panel.
  const renameAsset = async (assetId, name) => {
    const res = await apiFetch(`/overlay-builder/assets/${assetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErrorMsg(data.error || "Could not rename asset");
      return;
    }
    refreshAssets();
  };

  const assetUrl = (assetId) => apiUrl(`/overlay/custom/asset/${assetId}?token=${token}`);
  const overlayUrl = (sourceId) => {
    const source = overlaySources.find((item) => item.id === sourceId);
    if (!source || !token) return "";
    // preview=1 turns on the page's mock placeholder (backend/overlay/
    // preview-note.js) so an app overlay with no data yet reads as "waiting"
    // instead of blank. Only the editor adds it; the OBS-facing
    // /overlay/custom page never does, so live output stays transparent.
    // v= is a cache-buster: the overlay HTML and its shared script change
    // during development, and a browser/edge may otherwise serve the previous
    // copy — which, with a changed helper API, would break the page.
    const sep = source.path.includes("?") ? "&" : "?";
    return apiUrl(`${source.path}${sep}token=${encodeURIComponent(token)}&preview=1&v=2`);
  };
  const selectedLayer = layers.find((l) => l.id === selectedLayerId) || null;
  const zoomBy = (factor) => setZoomFactor((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +(z * factor).toFixed(3))));

  return (
    <div style={styles.root}>
      <div style={styles.topBar}>
        {brandSlot}
        <Toolbar
          onAddImage={uploadImage}
          onAddVideo={uploadVideo}
          onAddAudio={uploadAudio}
          onAddText={addText}
          onAddOverlay={addOverlay}
          onOpenMedia={() => setMediaOpen(true)}
          overlaySources={overlaySources}
          uploading={uploading}
          saveState={saveState}
        />
        <div style={styles.headerSpacer} />
        {headerControls}
      </div>
      {errorMsg && <div style={styles.errorBanner}>{errorMsg}</div>}
      <div style={styles.editorArea}>
        <LayersSidebar
          layers={layers}
          assets={assets}
          overlaySources={overlaySources}
          assetUrl={assetUrl}
          selectedLayerId={selectedLayerId}
          onSelect={setSelectedLayerId}
          onReorder={reorderLayers}
          onRename={renameLayer}
        />
        <div style={styles.canvasArea}>
          <div ref={viewportRef} data-canvas-viewport="" style={styles.viewport}>
            {/* The wrapper is sized to the already-scaled workspace (CSS
                transforms don't affect layout) and uses margin:auto rather than
                the viewport centering it, so zooming past the viewport size
                still lets every edge be scrolled to. The actual 1920x1080
                canvas sits inside, offset by the pasteboard margin. */}
            <div
              style={{
                width: (CANVAS_W + WORKSPACE_MARGIN * 2) * scale,
                height: (CANVAS_H + WORKSPACE_MARGIN * 2) * scale,
                position: "relative",
                flexShrink: 0,
                margin: "auto",
              }}
              onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedLayerId(null); }}
            >
              {/* Off-canvas pasteboard. pointerEvents:none keeps clicks landing
                  on the wrapper above (which clears the selection). */}
              <div style={styles.pasteboard} />
              <div
                style={{
                  width: CANVAS_W,
                  height: CANVAS_H,
                  position: "absolute",
                  top: WORKSPACE_MARGIN * scale,
                  left: WORKSPACE_MARGIN * scale,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                  ...styles.checkerboard,
                }}
                onMouseDown={(e) => { if (e.target === e.currentTarget) setSelectedLayerId(null); }}
              >
                {layers.map((layer) => (
                  <Rnd
                    key={layer.id}
                    size={{ width: layer.w, height: layer.h }}
                    position={{ x: layer.x, y: layer.y }}
                    scale={scale}
                    onDragStop={(e, d) => updateLayer(layer.id, { x: d.x, y: d.y })}
                    onResizeStop={(e, dir, ref, delta, pos) => updateLayer(layer.id, { w: ref.offsetWidth, h: ref.offsetHeight, x: pos.x, y: pos.y })}
                    onMouseDown={(e) => { e.stopPropagation(); setSelectedLayerId(layer.id); }}
                    style={{ outline: layer.id === selectedLayerId ? "2px solid var(--accent, #e11d76)" : "1px dashed rgba(255,255,255,0.35)" }}
                  >
                    <LayerContent layer={layer} assetUrl={assetUrl} overlayUrl={overlayUrl} overlaySources={overlaySources} latestByKind={latestByKind} />
                  </Rnd>
                ))}
              </div>
            </div>
          </div>

          {/* Sibling of the scrolling viewport (not a child), so it stays
              pinned to the bottom-right corner when the zoomed canvas is
              scrolled. */}
          <div style={styles.zoomBar}>
            <button
              type="button"
              style={styles.zoomBtn}
              onClick={() => zoomBy(1 / ZOOM_STEP)}
              disabled={zoomFactor <= ZOOM_MIN}
              title="Zoom out"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              style={styles.zoomPct}
              onClick={() => setZoomFactor(1)}
              title="Reset zoom to fit"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              style={styles.zoomBtn}
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={zoomFactor >= ZOOM_MAX}
              title="Zoom in"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div style={styles.sidebar}>
          <PropertyPanel
            layer={selectedLayer}
            assetUrl={assetUrl}
            overlaySources={overlaySources}
            onChange={(patch) => selectedLayer && updateLayer(selectedLayer.id, patch)}
            onDelete={() => selectedLayer && removeLayer(selectedLayer.id)}
            onReorder={(dir) => selectedLayer && reorderLayer(selectedLayer.id, dir)}
          />
        </div>
      </div>

      {mediaOpen && (
        <MediaLibraryModal
          assets={assets}
          assetUrl={assetUrl}
          usageBytes={usageBytes}
          quotaBytes={quotaBytes}
          onDelete={deleteAsset}
          onRename={renameAsset}
          deleteArmedAssetId={deleteArmedAssetId}
          onClose={() => { setMediaOpen(false); setDeleteArmedAssetId(null); }}
        />
      )}
    </div>
  );
}

// Left-hand layer list. The canvas itself is hit-tested top-down, so a layer
// covered by another one can't be clicked there — this lists every layer by
// name (topmost first, matching paint order) so it can still be selected and
// edited from the properties panel. Image rows show a thumbnail so identical
// "Image" entries can be told apart.
const LAYER_TYPE_LABELS = { text: "Text", image: "Image", video: "Video", sound: "Sound", overlay: "App overlay" };
function layerTypeIcon(type) {
  if (type === "image") return <ImageIcon size={14} color="var(--accent)" />;
  if (type === "video") return <Film size={14} color="var(--accent)" />;
  if (type === "sound") return <Volume2 size={14} color="var(--accent)" />;
  if (type === "overlay") return <PanelsTopLeft size={14} color="var(--accent)" />;
  return <Type size={14} color="var(--accent)" />;
}
function isLayerOffCanvas(layer) {
  return layer.x + layer.w <= 0 || layer.y + layer.h <= 0 || layer.x >= CANVAS_W || layer.y >= CANVAS_H;
}
function layerDefaultName(layer, sourceById, assetById) {
  if (layer.type === "text") return (layer.text || "").trim() || "Text";
  if (layer.type === "overlay") return sourceById.get(layer.sourceId)?.name || "App overlay";
  const asset = layer.assetId ? assetById.get(layer.assetId) : null;
  return asset?.name || LAYER_TYPE_LABELS[layer.type] || "Layer";
}

function LayersSidebar({ layers, assets, overlaySources, assetUrl, selectedLayerId, onSelect, onReorder, onRename }) {
  const listRef = useRef(null);
  const assetById = new Map(assets.map((a) => [a.id, a]));
  const sourceById = new Map(overlaySources.map((s) => [s.id, s]));
  const displayed = layers.slice().reverse();
  const [dragId, setDragId] = useState(null);
  const [dropHint, setDropHint] = useState(null); // { id, before }
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameFinishedRef = useRef(false);

  useEffect(() => {
    if (!selectedLayerId) return;
    const row = listRef.current?.querySelector(`[data-layer-id="${selectedLayerId}"]`);
    row?.scrollIntoView?.({ block: "nearest" });
  }, [selectedLayerId]);

  const clearDrag = () => { setDragId(null); setDropHint(null); };

  // `before` is relative to the target row in display order (topmost first);
  // onReorder expects that same display order.
  const dropOn = (targetId, before) => {
    if (!dragId || dragId === targetId) { clearDrag(); return; }
    const ids = displayed.map((l) => l.id).filter((id) => id !== dragId);
    const targetIndex = ids.indexOf(targetId);
    if (targetIndex === -1) { clearDrag(); return; }
    ids.splice(targetIndex + (before ? 0 : 1), 0, dragId);
    onReorder(ids);
    clearDrag();
  };

  const startRename = (layer) => {
    onSelect(layer.id);
    setRenamingId(layer.id);
    // Empty means "no custom name"; the current automatic label is shown as
    // the input's placeholder rather than pre-filled, so just pressing Enter
    // doesn't freeze a derived label.
    setRenameDraft(layer.name || "");
    renameFinishedRef.current = false;
  };

  // Enter/blur commit; Escape cancels. The guard prevents the blur that fires
  // after Enter/Escape from sending a second (or unintended) rename.
  const finishRename = (commit) => {
    if (renameFinishedRef.current) return;
    renameFinishedRef.current = true;
    if (commit && renamingId) onRename(renamingId, renameDraft.trim());
    setRenamingId(null);
  };

  return (
    <div style={styles.layersSidebar}>
      <div style={styles.layersHeader}>
        <div style={styles.panelTitle}>Layers</div>
        <span style={styles.layersCount}>{layers.length}</span>
      </div>
      <div style={styles.layersHint}>Top of the list draws above the rest. Drag to reorder · double-click to rename · drag past the edge to go off-canvas.</div>
      {layers.length === 0 ? (
        <div style={styles.panelEmpty}>No layers yet.</div>
      ) : (
        <div
          ref={listRef}
          style={styles.layerList}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropHint(null); }}
        >
          {displayed.map((layer) => {
            const selected = layer.id === selectedLayerId;
            const asset = layer.assetId ? assetById.get(layer.assetId) : null;
            const source = layer.sourceId ? sourceById.get(layer.sourceId) : null;
            const typeLabel = LAYER_TYPE_LABELS[layer.type] || "Layer";
            const primary = (layer.name || "").trim() || layerDefaultName(layer, sourceById, assetById);
            const hint = dropHint?.id === layer.id ? dropHint : null;
            const renaming = renamingId === layer.id;
            return (
              <div
                key={layer.id}
                data-layer-id={layer.id}
                draggable={!renaming}
                style={{
                  ...styles.layerRow,
                  ...(selected ? styles.layerRowSelected : null),
                  ...(dragId === layer.id ? styles.layerRowDragging : null),
                  ...(hint ? (hint.before ? styles.layerDropBefore : styles.layerDropAfter) : null),
                }}
                onDragStart={(e) => {
                  setDragId(layer.id);
                  e.dataTransfer.effectAllowed = "move";
                  try { e.dataTransfer.setData("text/plain", layer.id); } catch { /* IE/edge cases */ }
                }}
                onDragOver={(e) => {
                  if (!dragId || dragId === layer.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDropHint({ id: layer.id, before: (e.clientY ?? 0) < rect.top + rect.height / 2 });
                }}
                onDrop={(e) => {
                  if (!dragId || dragId === layer.id) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  dropOn(layer.id, (e.clientY ?? 0) < rect.top + rect.height / 2);
                }}
                onDragEnd={clearDrag}
              >
                {renaming ? (
                  <input
                    data-layer-rename=""
                    autoFocus
                    value={renameDraft}
                    maxLength={80}
                    placeholder={primary}
                    style={styles.layerRenameInput}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={() => finishRename(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); finishRename(true); }
                      else if (e.key === "Escape") { e.preventDefault(); finishRename(false); }
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      data-layer-select=""
                      style={styles.layerSelect}
                      onClick={() => onSelect(layer.id)}
                      onDoubleClick={() => startRename(layer)}
                      title={`${primary} — double-click to rename`}
                    >
                      <span style={styles.layerThumb}>
                        {layer.type === "image" && asset
                          ? <img src={assetUrl(layer.assetId)} alt="" style={styles.layerThumbImg} draggable={false} />
                          : layerTypeIcon(layer.type)}
                      </span>
                      <span style={styles.layerText}>
                        <span style={styles.layerLabel}>{primary}</span>
                        <span style={styles.layerMeta}>
                          {typeLabel} · {Math.round(layer.w)}×{Math.round(layer.h)}
                          {asset ? ` · ${formatBytes(asset.sizeBytes)}` : ""}
                        </span>
                      </span>
                    </button>
                    {isLayerOffCanvas(layer) && (
                      <span style={styles.offCanvasBadge} title="Fully outside the canvas">
                        <EyeOff size={12} />
                      </span>
                    )}
                    <button
                      type="button"
                      style={styles.layerMiniBtn}
                      onClick={() => startRename(layer)}
                      title="Rename layer"
                    >
                      <Pencil size={12} />
                    </button>
                    <span style={styles.layerGrip} aria-hidden="true"><GripVertical size={13} /></span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LayerContent({ layer, assetUrl, overlayUrl, overlaySources, latestByKind }) {
  if (layer.type === "overlay") {
    const src = overlayUrl(layer.sourceId);
    return src ? (
      <iframe
        title={overlaySources.find((source) => source.id === layer.sourceId)?.name || "Overlay"}
        src={src}
        style={styles.layerFrame}
        tabIndex={-1}
      />
    ) : <div style={styles.overlayPlaceholder}>Loading overlay…</div>;
  }
  if (layer.type === "image") {
    return (
      <img
        src={assetUrl(layer.assetId)}
        alt=""
        style={{ ...styles.layerMedia, filter: hsbFilter(layer), opacity: (layer.opacity ?? 100) / 100 }}
        draggable={false}
      />
    );
  }
  if (layer.type === "video") {
    return (
      <video
        src={assetUrl(layer.assetId)}
        style={styles.layerMedia}
        autoPlay={layer.autoplay === true}
        loop={layer.playMode !== "once"}
        muted={layer.muted !== false}
        playsInline
      />
    );
  }
  if (layer.type === "sound") {
    return (
      <div style={styles.soundPlaceholder}>
        <Volume2 size={28} />
        <div style={{ fontSize: 10, opacity: 0.8 }}>Sound</div>
      </div>
    );
  }
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: layer.align === "center" ? "center" : layer.align === "right" ? "flex-end" : "flex-start",
        fontSize: layer.fontSize,
        color: layer.color,
        fontWeight: layer.bold ? 700 : 400,
        textAlign: layer.align,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflow: "hidden",
      }}
    >
      {fillTemplate(layer.text, latestByKind)}
    </div>
  );
}

function Toolbar({ onAddImage, onAddVideo, onAddAudio, onAddText, onAddOverlay, onOpenMedia, overlaySources, uploading, saveState }) {
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);

  return (
    <div style={styles.toolbarGroup}>
      <button style={styles.toolBtn} disabled={uploading} onClick={() => imageInputRef.current?.click()}><ImageIcon size={14} color="var(--accent)" /> Add Image</button>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files[0]) onAddImage(e.target.files[0]); e.target.value = ""; }}
      />
      <button style={styles.toolBtn} disabled={uploading} onClick={() => videoInputRef.current?.click()}><Film size={14} color="var(--accent)" /> Add Video</button>
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm"
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files[0]) onAddVideo(e.target.files[0]); e.target.value = ""; }}
      />
      <button style={styles.toolBtn} disabled={uploading} onClick={() => audioInputRef.current?.click()}><Volume2 size={14} color="var(--accent)" /> Add Sound</button>
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/mpeg,audio/wav,audio/ogg"
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files[0]) onAddAudio(e.target.files[0]); e.target.value = ""; }}
      />
      <button style={styles.toolBtn} onClick={onAddText}><Type size={14} color="var(--accent)" /> Add Text</button>
      <label style={styles.overlayPickerLabel}>
        <PanelsTopLeft size={14} color="var(--accent)" />
        <select style={styles.overlayPicker} value="" onChange={(e) => { if (e.target.value) onAddOverlay(e.target.value); }}>
          <option value="">Add app overlay…</option>
          {overlaySources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select>
      </label>
      <button style={styles.toolBtn} onClick={onOpenMedia} title="Media library">
        <Images size={14} color="var(--accent)" /> Media
      </button>
      <div style={styles.saveIndicator}>
        {uploading ? "Uploading…" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
      </div>
    </div>
  );
}

// Chat-command / channel-point-redeem trigger config, shared by video and
// sound layers — see overlay/custom.html's checkTriggers/matchesCommand for
// how these fields are actually matched live. Enabling the trigger forces
// playMode to "once" in the same call (looping forever off one command makes
// no sense), matching backend/overlayLayouts.js's server-side enforcement.
function TriggerFields({ layer, onChange }) {
  return (
    <>
      <label style={styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={!!layer.triggerEnabled}
          onChange={(e) => onChange({ triggerEnabled: e.target.checked, playMode: e.target.checked ? "once" : layer.playMode })}
        />
        Enable chat/redeem trigger
      </label>
      {layer.triggerEnabled && (
        <>
          <label style={styles.label}>Trigger type
            <select style={styles.input} value={layer.triggerType || "command"} onChange={(e) => onChange({ triggerType: e.target.value })}>
              <option value="command">Chat command</option>
              <option value="redeem">Channel point redeem</option>
            </select>
          </label>
          <label style={styles.label}>{layer.triggerType === "redeem" ? "Reward title" : "Chat command"}
            <input
              type="text"
              style={styles.input}
              value={layer.triggerValue || ""}
              placeholder={layer.triggerType === "redeem" ? "Hydrate" : "!balazo"}
              onChange={(e) => onChange({ triggerValue: e.target.value })}
            />
          </label>
          {layer.triggerType !== "redeem" && (
            <label style={styles.label}>Minimum role
              <select style={styles.input} value={layer.minRole || "everyone"} onChange={(e) => onChange({ minRole: e.target.value })}>
                <option value="everyone">Everyone</option>
                <option value="vip">VIP</option>
                <option value="moderator">Moderator</option>
                <option value="broadcaster">Broadcaster</option>
              </select>
            </label>
          )}
        </>
      )}
    </>
  );
}

function PropertyPanel({ layer, assetUrl, overlaySources, onChange, onDelete, onReorder }) {
  const textareaRef = useRef(null);

  if (!layer) {
    return (
      <div style={styles.panel}>
        <div style={styles.panelTitle}>Properties</div>
        <div style={styles.panelEmpty}>Select a layer to edit it.</div>
      </div>
    );
  }

  // Inserts a {namespace.field} token at the cursor (or replaces the current
  // selection), so streamers don't have to memorize/hand-type the syntax.
  const insertToken = (token) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? layer.text.length;
    const end = el?.selectionEnd ?? layer.text.length;
    const next = layer.text.slice(0, start) + token + layer.text.slice(end);
    onChange({ text: next });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div style={styles.panel}>
      <div style={styles.panelTitle}>Properties — {layer.type}</div>

      <label style={styles.label}>Layer name
        <input
          type="text"
          style={styles.input}
          value={layer.name || ""}
          maxLength={80}
          placeholder="Automatic"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>

      {layer.type === "overlay" && (
        <>
          <label style={styles.label}>App overlay
            <select style={styles.input} value={layer.sourceId} onChange={(e) => onChange({ sourceId: e.target.value })}>
              {overlaySources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
          </label>
          <div style={styles.tokenHint}>Live preview. The overlay keeps its settings from its app panel.</div>
        </>
      )}

      {layer.type === "text" && (
        <>
          <label style={styles.label}>Text
            <textarea
              ref={textareaRef}
              style={styles.textarea}
              value={layer.text}
              onChange={(e) => onChange({ text: e.target.value })}
              rows={3}
            />
          </label>
          <div style={styles.tokenRow}>
            {TOKEN_INSERT_BUTTONS.map((b) => (
              <button key={b.token} type="button" style={styles.tokenBtn} onClick={() => insertToken(b.token)} title={`Insert ${b.token}`}>
                {b.label}
              </button>
            ))}
          </div>
          <div style={styles.tokenHint}>{TOKEN_HINT}</div>
          <label style={styles.label}>Font size
            <input type="number" style={styles.input} value={layer.fontSize} min={8} max={300}
              onChange={(e) => onChange({ fontSize: Number(e.target.value) || 32 })} />
          </label>
          <label style={styles.label}>Color
            <input type="color" style={styles.colorInput} value={layer.color}
              onChange={(e) => onChange({ color: e.target.value })} />
          </label>
          <label style={styles.checkboxLabel}>
            <input type="checkbox" checked={layer.bold} onChange={(e) => onChange({ bold: e.target.checked })} />
            Bold
          </label>
          <label style={styles.label}>Align
            <select style={styles.input} value={layer.align} onChange={(e) => onChange({ align: e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
        </>
      )}

      {layer.type === "image" && (
        <>
          <label style={styles.label}>Hue ({Math.round(layer.hue || 0)}°)
            <input type="range" style={{ ...styles.slider, "--pct": `${((layer.hue || 0) + 180) / 360 * 100}%` }} min={-180} max={180} value={layer.hue || 0}
              onChange={(e) => onChange({ hue: Number(e.target.value) })} />
          </label>
          <label style={styles.label}>Saturation ({Math.round(layer.saturation ?? 100)}%)
            <input type="range" style={{ ...styles.slider, "--pct": `${(layer.saturation ?? 100) / 200 * 100}%` }} min={0} max={200} value={layer.saturation ?? 100}
              onChange={(e) => onChange({ saturation: Number(e.target.value) })} />
          </label>
          <label style={styles.label}>Brightness ({Math.round(layer.brightness ?? 100)}%)
            <input type="range" style={{ ...styles.slider, "--pct": `${(layer.brightness ?? 100) / 200 * 100}%` }} min={0} max={200} value={layer.brightness ?? 100}
              onChange={(e) => onChange({ brightness: Number(e.target.value) })} />
          </label>
          <label style={styles.label}>Opacity ({Math.round(layer.opacity ?? 100)}%)
            <input type="range" style={{ ...styles.slider, "--pct": `${layer.opacity ?? 100}%` }} min={0} max={100} value={layer.opacity ?? 100}
              onChange={(e) => onChange({ opacity: Number(e.target.value) })} />
          </label>
          <button style={styles.toolBtn} onClick={() => onChange({ hue: 0, saturation: 100, brightness: 100, opacity: 100 })}>
            Reset adjustments
          </button>
        </>
      )}

      {layer.type === "video" && (
        <>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={layer.autoplay === true}
              disabled={layer.triggerEnabled}
              onChange={(e) => onChange({ autoplay: e.target.checked })}
            />
            Autoplay
          </label>
          <label style={styles.label}>Playback
            <select
              style={styles.input}
              value={layer.triggerEnabled ? "once" : (layer.playMode || "loop")}
              disabled={layer.triggerEnabled}
              onChange={(e) => onChange({ playMode: e.target.value })}
            >
              <option value="loop">Loop</option>
              <option value="once">Play once</option>
            </select>
          </label>
          <label style={styles.checkboxLabel}>
            <input type="checkbox" checked={layer.muted !== false} onChange={(e) => onChange({ muted: e.target.checked })} />
            Muted
          </label>
          <label style={styles.checkboxLabel}>
            <input type="checkbox" checked={!!layer.randomPosition} onChange={(e) => onChange({ randomPosition: e.target.checked })} />
            Random position on each play
          </label>
          <TriggerFields layer={layer} onChange={onChange} />
        </>
      )}

      {layer.type === "sound" && (
        <>
          <label style={styles.label}>Volume ({Math.round(layer.volume ?? 100)}%)
            <input type="range" style={{ ...styles.slider, "--pct": `${layer.volume ?? 100}%` }} min={0} max={100} value={layer.volume ?? 100}
              onChange={(e) => onChange({ volume: Number(e.target.value) })} />
          </label>
          <audio controls src={assetUrl(layer.assetId)} style={{ width: "100%" }} />
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={layer.autoplay === true}
              disabled={layer.triggerEnabled}
              onChange={(e) => onChange({ autoplay: e.target.checked })}
            />
            Autoplay
          </label>
          <label style={styles.label}>Playback
            <select
              style={styles.input}
              value={layer.triggerEnabled ? "once" : (layer.playMode || "loop")}
              disabled={layer.triggerEnabled}
              onChange={(e) => onChange({ playMode: e.target.value })}
            >
              <option value="loop">Loop</option>
              <option value="once">Play once</option>
            </select>
          </label>
          <TriggerFields layer={layer} onChange={onChange} />
        </>
      )}

      <div style={styles.posRow}>
        <label style={styles.labelSmall}>X<input type="number" style={styles.inputSmall} value={Math.round(layer.x)} onChange={(e) => onChange({ x: Number(e.target.value) || 0 })} /></label>
        <label style={styles.labelSmall}>Y<input type="number" style={styles.inputSmall} value={Math.round(layer.y)} onChange={(e) => onChange({ y: Number(e.target.value) || 0 })} /></label>
      </div>
      <div style={styles.posRow}>
        <label style={styles.labelSmall}>W<input type="number" style={styles.inputSmall} value={Math.round(layer.w)} onChange={(e) => onChange({ w: Number(e.target.value) || 1 })} /></label>
        <label style={styles.labelSmall}>H<input type="number" style={styles.inputSmall} value={Math.round(layer.h)} onChange={(e) => onChange({ h: Number(e.target.value) || 1 })} /></label>
      </div>

      <div style={styles.panelActions}>
        <button style={styles.toolBtn} onClick={() => onReorder("back")}><ArrowDown size={14} color="var(--accent)" /> Send back</button>
        <button style={styles.toolBtn} onClick={() => onReorder("front")}><ArrowUp size={14} color="var(--accent)" /> Bring front</button>
      </div>
      <button
        style={styles.toolBtn}
        onClick={() => onChange({ x: Math.round((CANVAS_W - layer.w) / 2), y: Math.round((CANVAS_H - layer.h) / 2) })}
      >
        <Crosshair size={14} color="var(--accent)" /> Center on canvas
      </button>
      <button style={styles.deleteBtn} onClick={onDelete}><Trash2 size={14} /> Delete layer</button>
    </div>
  );
}

function MediaLibraryModal({ assets, assetUrl, usageBytes, quotaBytes, onDelete, onRename, deleteArmedAssetId, onClose }) {
  const pct = quotaBytes ? Math.min(100, (usageBytes / quotaBytes) * 100) : 0;
  return (
    <div style={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={styles.mediaModal}>
        <div style={styles.mediaHeader}>
          <div style={styles.mediaTitleRow}>
            <div style={styles.panelTitle}>Media Library</div>
            <button type="button" style={styles.mediaCloseBtn} onClick={onClose} title="Close">
              <X size={16} color="var(--text)" />
            </button>
          </div>
          <div style={styles.quotaRow}>
            <div style={styles.quotaLabel}>{formatBytes(usageBytes)} / {formatBytes(quotaBytes)} used</div>
            <div style={styles.quotaTrack}>
              <div style={{ ...styles.quotaFill, width: `${pct}%`, background: pct >= 90 ? "var(--red)" : "var(--accent)" }} />
            </div>
          </div>
        </div>
        <div style={styles.mediaBody}>
          {assets.length === 0 ? (
            <div style={styles.panelEmpty}>No uploads yet. Use “Add Image”, “Add Video” or “Add Sound” to upload media.</div>
          ) : (
            <div style={styles.mediaGrid}>
              {assets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  assetUrl={assetUrl}
                  onRename={onRename}
                  onDelete={onDelete}
                  deleteArmed={deleteArmedAssetId === asset.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssetCard({ asset, assetUrl, onRename, onDelete, deleteArmed }) {
  const [name, setName] = useState(asset.name || "");
  const skipCommitRef = useRef(false);
  useEffect(() => { setName(asset.name || ""); }, [asset.name]);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed !== (asset.name || "").trim()) onRename(asset.id, trimmed);
  };

  return (
    <div style={styles.assetCardModal}>
      <div style={styles.assetPreview}>
        {asset.kind === "image" ? (
          <img src={assetUrl(asset.id)} alt="" style={styles.assetPreviewImg} />
        ) : (
          <div style={styles.assetPreviewPlaceholder}>
            {asset.kind === "video" ? <Film size={30} /> : <Volume2 size={30} />}
          </div>
        )}
        <span style={styles.assetKindBadge}>{asset.kind === "audio" ? "Audio" : asset.kind === "image" ? "Image" : "Video"}</span>
        <button
          type="button"
          style={deleteArmed ? styles.assetDeleteBtnModalArmed : styles.assetDeleteBtnModal}
          onClick={() => onDelete(asset.id)}
          onBlur={() => deleteArmed && onDelete(null)}
          title={deleteArmed ? "Click again to confirm" : "Delete asset"}
        >
          {deleteArmed ? <Check size={14} color="var(--accent)" /> : <X size={14} color="var(--accent)" />}
        </button>
      </div>
      <input
        type="text"
        style={styles.assetNameInput}
        value={name}
        maxLength={80}
        placeholder="Unnamed asset"
        title="Asset name"
        onChange={(e) => setName(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          if (skipCommitRef.current) { skipCommitRef.current = false; return; }
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === "Escape") {
            e.preventDefault();
            skipCommitRef.current = true;
            setName(asset.name || "");
            e.currentTarget.blur();
          }
        }}
      />
      <div style={styles.assetMetaModal}>{formatBytes(asset.sizeBytes)} · {asset.mime}</div>
    </div>
  );
}

const CHECKER_SIZE = 24;
const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 14px",
    background: "var(--surface)",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
    flexWrap: "wrap",
  },
  headerSpacer: {
    flex: 1,
    minWidth: 8,
  },
  toolbarGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
    minWidth: 0,
  },
  toolBtn: {
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    padding: "5px 10px",
    flexShrink: 0,
  },
  overlayPickerLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    border: "1px solid var(--border)",
    borderRadius: 9,
    background: "var(--surface2)",
    color: "var(--text)",
    fontSize: 13,
    fontFamily: "Quicksand, sans-serif",
    flexShrink: 0,
  },
  overlayPicker: {
    width: 168,
    minWidth: 150,
    background: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: "4px 6px",
  },
  saveIndicator: {
    marginLeft: 2,
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  },
  editorArea: {
    flex: 1,
    display: "flex",
    minHeight: 0,
  },
  layersSidebar: {
    width: 232,
    flexShrink: 0,
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "12px 10px",
    overflowY: "auto",
    background: "var(--surface)",
  },
  layersHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  layersCount: {
    fontSize: 10,
    fontWeight: 700,
    color: "var(--text-muted)",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 99,
    padding: "0 6px",
    lineHeight: "16px",
  },
  layersHint: {
    fontSize: 10,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  },
  layerList: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  },
  layerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "5px 6px",
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 6,
    color: "var(--text)",
    textAlign: "left",
    fontFamily: "Nunito, system-ui, sans-serif",
    fontWeight: 400,
    cursor: "grab",
  },
  layerRowSelected: {
    background: "color-mix(in srgb, var(--accent) 16%, transparent)",
    border: "1px solid var(--accent)",
  },
  layerRowDragging: {
    opacity: 0.4,
  },
  layerDropBefore: {
    boxShadow: "inset 0 2px 0 0 var(--accent)",
  },
  layerDropAfter: {
    boxShadow: "inset 0 -2px 0 0 var(--accent)",
  },
  layerGrip: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    color: "var(--text-muted)",
    opacity: 0.55,
  },
  layerSelect: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 8,
    flex: 1,
    minWidth: 0,
    padding: 0,
    background: "transparent",
    border: "none",
    borderRadius: 4,
    color: "inherit",
    textAlign: "left",
    fontFamily: "Nunito, system-ui, sans-serif",
    fontWeight: 400,
  },
  layerMiniBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 2,
    background: "transparent",
    border: "none",
    borderRadius: 4,
    color: "var(--text-muted)",
    opacity: 0.55,
  },
  layerRenameInput: {
    width: "100%",
    minWidth: 0,
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--accent)",
    borderRadius: 4,
    padding: "4px 6px",
    fontFamily: "Nunito, system-ui, sans-serif",
    fontSize: 12,
    fontWeight: 600,
  },
  layerThumb: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    flexShrink: 0,
    borderRadius: 4,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    overflow: "hidden",
  },
  layerThumbImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  layerText: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flex: 1,
  },
  layerLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  layerMeta: {
    fontSize: 9,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  offCanvasBadge: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    color: "var(--yellow)",
  },
  canvasArea: {
    flex: 1,
    minWidth: 0,
    position: "relative",
    display: "flex",
  },
  viewport: {
    flex: 1,
    display: "flex",
    overflow: "auto",
    padding: 20,
    minWidth: 0,
  },
  zoomBar: {
    position: "absolute",
    bottom: 14,
    right: 16,
    zIndex: 5,
    display: "flex",
    alignItems: "center",
    gap: 2,
    padding: 3,
    borderRadius: 9,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    boxShadow: "var(--shadow)",
  },
  zoomBtn: {
    padding: "4px 6px",
    background: "transparent",
    color: "var(--text)",
    border: "none",
    borderRadius: 6,
    justifyContent: "center",
  },
  zoomPct: {
    minWidth: 48,
    padding: "4px 6px",
    background: "transparent",
    color: "var(--text)",
    border: "none",
    borderRadius: 6,
    justifyContent: "center",
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
  },
  pasteboard: {
    position: "absolute",
    inset: 0,
    borderRadius: 10,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    backgroundImage: "radial-gradient(circle, color-mix(in srgb, var(--text-muted) 35%, transparent) 1px, transparent 1px)",
    backgroundSize: "18px 18px",
    pointerEvents: "none",
  },
  checkerboard: {
    backgroundImage:
      `linear-gradient(45deg, #808080 25%, transparent 25%), linear-gradient(-45deg, #808080 25%, transparent 25%), ` +
      `linear-gradient(45deg, transparent 75%, #808080 75%), linear-gradient(-45deg, transparent 75%, #808080 75%)`,
    backgroundSize: `${CHECKER_SIZE * 2}px ${CHECKER_SIZE * 2}px`,
    backgroundPosition: `0 0, 0 ${CHECKER_SIZE}px, ${CHECKER_SIZE}px -${CHECKER_SIZE}px, -${CHECKER_SIZE}px 0px`,
    backgroundColor: "#3a3a3a",
    boxShadow: "0 0 0 1px rgba(255,255,255,0.15)",
  },
  layerMedia: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    pointerEvents: "none",
  },
  layerFrame: {
    display: "block",
    width: "100%",
    height: "100%",
    border: 0,
    background: "transparent",
    pointerEvents: "none",
  },
  overlayPlaceholder: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    color: "var(--text-muted)",
    border: "1px dashed var(--border)",
    pointerEvents: "none",
  },
  soundPlaceholder: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    color: "#fff",
    background: "rgba(225, 29, 118, 0.25)",
    border: "1px dashed rgba(255,255,255,0.4)",
    borderRadius: 6,
    pointerEvents: "none",
  },
  sidebar: {
    width: 300,
    flexShrink: 0,
    borderLeft: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    background: "var(--surface)",
  },
  panel: {
    padding: "12px 14px",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  panelTitle: {
    fontWeight: 700,
    fontSize: 13,
    color: "var(--accent-light)",
    textTransform: "capitalize",
  },
  panelEmpty: {
    color: "var(--text-muted)",
    fontSize: 12,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 12,
    color: "var(--text-muted)",
  },
  labelSmall: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 11,
    color: "var(--text-muted)",
    flex: 1,
  },
  checkboxLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text)",
  },
  input: {
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "4px 6px",
  },
  slider: {
    width: "100%",
  },
  inputSmall: {
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "4px 6px",
    width: "100%",
  },
  textarea: {
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "6px 8px",
    resize: "vertical",
    fontFamily: "inherit",
  },
  tokenRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
  },
  tokenBtn: {
    background: "var(--surface2)",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontSize: 11,
    padding: "3px 6px",
  },
  tokenHint: {
    fontSize: 10,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  },
  colorInput: {
    width: 60,
    height: 28,
    padding: 0,
    border: "1px solid var(--border)",
    borderRadius: 4,
    background: "none",
  },
  posRow: {
    display: "flex",
    gap: 8,
  },
  panelActions: {
    display: "flex",
    gap: 8,
    marginTop: 4,
  },
  deleteBtn: {
    background: "var(--red)",
    color: "#fff",
    border: "none",
  },
  quotaRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    marginBottom: 4,
  },
  quotaLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  quotaTrack: {
    height: 6,
    borderRadius: 3,
    background: "var(--border)",
    overflow: "hidden",
  },
  quotaFill: {
    height: "100%",
    transition: "width 0.3s ease",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 100,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    background: "rgba(0, 0, 0, 0.55)",
  },
  mediaModal: {
    width: "min(860px, 94vw)",
    maxHeight: "82vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    boxShadow: "var(--shadow)",
    overflow: "hidden",
  },
  mediaHeader: {
    flexShrink: 0,
    padding: "14px 16px",
    borderBottom: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  mediaTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mediaCloseBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
    background: "transparent",
    border: "none",
    color: "var(--text)",
    borderRadius: 6,
  },
  mediaBody: {
    padding: 16,
    overflowY: "auto",
    minHeight: 120,
  },
  mediaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 14,
  },
  assetCardModal: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 10,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
  },
  assetPreview: {
    position: "relative",
    aspectRatio: "16 / 10",
    borderRadius: 6,
    overflow: "hidden",
    background: "var(--bg)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  assetPreviewImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  assetPreviewPlaceholder: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    color: "var(--text-muted)",
  },
  assetKindBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    fontSize: 9,
    fontWeight: 700,
    color: "var(--text)",
    background: "rgba(0, 0, 0, 0.65)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "1px 5px",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  assetDeleteBtnModal: {
    position: "absolute",
    top: 6,
    right: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    padding: 0,
    background: "rgba(0, 0, 0, 0.65)",
    border: "none",
    borderRadius: 5,
  },
  assetDeleteBtnModalArmed: {
    position: "absolute",
    top: 6,
    right: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 24,
    height: 24,
    padding: 0,
    background: "var(--red)",
    border: "none",
    borderRadius: 5,
  },
  assetNameInput: {
    width: "100%",
    background: "var(--surface)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "5px 7px",
    fontFamily: "Nunito, system-ui, sans-serif",
    fontSize: 12,
  },
  assetMetaModal: {
    fontSize: 10,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  errorBanner: {
    background: "var(--red)",
    color: "#fff",
    fontSize: 13,
    padding: "6px 12px",
    flexShrink: 0,
  },
};
