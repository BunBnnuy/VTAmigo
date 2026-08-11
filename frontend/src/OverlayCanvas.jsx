import React, { useState, useEffect, useRef, useCallback } from "react";
import { Rnd } from "react-rnd";
import { apiFetch, apiUrl } from "./api.js";
import {
  Volume2,
  Image as ImageIcon,
  Film,
  Type,
  ArrowDown,
  ArrowUp,
  Trash2,
  Check,
  X,
} from "lucide-react";

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const SAVE_DEBOUNCE_MS = 800;

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
export default function OverlayCanvas({ layoutId, latestByKind }) {
  const [layers, setLayers] = useState([]);
  const [assets, setAssets] = useState([]);
  const [usageBytes, setUsageBytes] = useState(0);
  const [quotaBytes, setQuotaBytes] = useState(100 * 1024 * 1024);
  const [token, setToken] = useState("");
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [fitScale, setFitScale] = useState(0.25);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [deleteArmedAssetId, setDeleteArmedAssetId] = useState(null);

  const viewportRef = useRef(null);
  const saveTimerRef = useRef(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

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
      setFitScale(Math.max(0.05, Math.min(availW / CANVAS_W, availH / CANVAS_H)));
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

  const uploadImage = (file) => {
    setUploading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await apiFetch("/overlay-builder/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl: reader.result }),
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

  const deleteAsset = async (assetId) => {
    if (deleteArmedAssetId !== assetId) { setDeleteArmedAssetId(assetId); return; }
    setDeleteArmedAssetId(null);
    await apiFetch(`/overlay-builder/assets/${assetId}`, { method: "DELETE" });
    refreshAssets();
    refreshLayout();
  };

  const assetUrl = (assetId) => apiUrl(`/overlay/custom/asset/${assetId}?token=${token}`);
  const selectedLayer = layers.find((l) => l.id === selectedLayerId) || null;

  return (
    <div style={styles.root}>
      <Toolbar
        onAddImage={uploadImage}
        onAddVideo={uploadVideo}
        onAddAudio={uploadAudio}
        onAddText={addText}
        uploading={uploading}
        saveState={saveState}
      />
      {errorMsg && <div style={styles.errorBanner}>{errorMsg}</div>}
      <div style={styles.editorArea}>
        <div ref={viewportRef} style={styles.viewport}>
          {/* Flexbox centers based on the UNSCALED layout box (CSS transform
              only affects paint, not layout) — so this wrapper is sized to
              the already-scaled dimensions for centering to land correctly,
              and the actual 1920x1080 canvas below fills it exactly via
              scale + absolute positioning. */}
          <div style={{ width: CANVAS_W * fitScale, height: CANVAS_H * fitScale, position: "relative", flexShrink: 0 }}>
            <div
              style={{
                width: CANVAS_W,
                height: CANVAS_H,
                position: "absolute",
                top: 0,
                left: 0,
                transform: `scale(${fitScale})`,
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
                  scale={fitScale}
                  bounds="parent"
                  onDragStop={(e, d) => updateLayer(layer.id, { x: d.x, y: d.y })}
                  onResizeStop={(e, dir, ref, delta, pos) => updateLayer(layer.id, { w: ref.offsetWidth, h: ref.offsetHeight, x: pos.x, y: pos.y })}
                  onMouseDown={(e) => { e.stopPropagation(); setSelectedLayerId(layer.id); }}
                  style={{ outline: layer.id === selectedLayerId ? "2px solid var(--accent, #e11d76)" : "1px dashed rgba(255,255,255,0.35)" }}
                >
                  <LayerContent layer={layer} assetUrl={assetUrl} latestByKind={latestByKind} />
                </Rnd>
              ))}
            </div>
          </div>
        </div>

        <div style={styles.sidebar}>
          <PropertyPanel
            layer={selectedLayer}
            assetUrl={assetUrl}
            onChange={(patch) => selectedLayer && updateLayer(selectedLayer.id, patch)}
            onDelete={() => selectedLayer && removeLayer(selectedLayer.id)}
            onReorder={(dir) => selectedLayer && reorderLayer(selectedLayer.id, dir)}
          />
          <AssetsSidebar
            assets={assets}
            assetUrl={assetUrl}
            onDelete={deleteAsset}
            deleteArmedAssetId={deleteArmedAssetId}
            usageBytes={usageBytes}
            quotaBytes={quotaBytes}
          />
        </div>
      </div>
    </div>
  );
}

function LayerContent({ layer, assetUrl, latestByKind }) {
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

function Toolbar({ onAddImage, onAddVideo, onAddAudio, onAddText, uploading, saveState }) {
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);
  const audioInputRef = useRef(null);

  return (
    <div style={styles.toolbar}>
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

function PropertyPanel({ layer, assetUrl, onChange, onDelete, onReorder }) {
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
      <button style={styles.deleteBtn} onClick={onDelete}><Trash2 size={14} /> Delete layer</button>
    </div>
  );
}

function AssetsSidebar({ assets, assetUrl, onDelete, deleteArmedAssetId, usageBytes, quotaBytes }) {
  const pct = quotaBytes ? Math.min(100, (usageBytes / quotaBytes) * 100) : 0;
  return (
    <div style={styles.panel}>
      <div style={styles.panelTitle}>Media Library</div>
      <div style={styles.quotaRow}>
        <div style={styles.quotaLabel}>{formatBytes(usageBytes)} / {formatBytes(quotaBytes)} used</div>
        <div style={styles.quotaTrack}>
          <div style={{ ...styles.quotaFill, width: `${pct}%`, background: pct >= 90 ? "var(--red)" : "var(--accent)" }} />
        </div>
      </div>
      {assets.length === 0 && <div style={styles.panelEmpty}>No uploads yet.</div>}
      <div style={styles.assetGrid}>
        {assets.map((a) => {
          const armed = deleteArmedAssetId === a.id;
          return (
            <div key={a.id} style={styles.assetCard}>
              {a.kind === "image" ? (
                <img src={assetUrl(a.id)} alt="" style={styles.assetThumb} />
              ) : (
                <div style={styles.assetThumbVideo}>{a.kind === "video" ? <Film size={24} /> : <Volume2 size={24} />}</div>
              )}
              <div style={styles.assetMeta}>{formatBytes(a.sizeBytes)}</div>
              <button
                style={armed ? styles.assetDeleteBtnArmed : styles.assetDeleteBtn}
                onClick={() => onDelete(a.id)}
                onBlur={() => armed && onDelete(null)}
                title={armed ? "Click again to confirm" : "Delete"}
              >
                {armed ? <Check size={14} color="var(--accent)" /> : <X size={14} color="var(--accent)" />}
              </button>
            </div>
          );
        })}
      </div>
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
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  toolBtn: {
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
  saveIndicator: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
  },
  editorArea: {
    flex: 1,
    display: "flex",
    minHeight: 0,
  },
  viewport: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "auto",
    padding: 20,
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
  assetGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  assetCard: {
    position: "relative",
    aspectRatio: "1",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
    background: "var(--surface2)",
  },
  assetThumb: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  assetThumbVideo: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 24,
  },
  assetMeta: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    fontSize: 9,
    color: "#fff",
    background: "rgba(0,0,0,0.6)",
    padding: "1px 4px",
  },
  assetDeleteBtn: {
    position: "absolute",
    top: 2,
    right: 2,
    background: "rgba(0,0,0,0.6)",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    width: 18,
    height: 18,
    fontSize: 10,
    lineHeight: "18px",
    padding: 0,
  },
  assetDeleteBtnArmed: {
    position: "absolute",
    top: 2,
    right: 2,
    background: "var(--red)",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    width: 18,
    height: 18,
    fontSize: 10,
    lineHeight: "18px",
    padding: 0,
  },
  errorBanner: {
    background: "var(--red)",
    color: "#fff",
    fontSize: 13,
    padding: "6px 12px",
    flexShrink: 0,
  },
};
