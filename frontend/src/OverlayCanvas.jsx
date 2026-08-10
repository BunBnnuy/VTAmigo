import React, { useState, useEffect, useRef, useCallback } from "react";
import { Rnd } from "react-rnd";
import { apiFetch, apiUrl } from "./api.js";

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

// The editor for one layout: a 1920x1080 transparent canvas (react-rnd
// layers, scaled to fit the viewport), a toolbar to add image/text/video
// layers, a property panel for the selected layer, and a media-library
// sidebar of this account's uploaded assets. Changes autosave (debounced)
// via PUT /overlay-builder/layouts/:id, which also broadcasts the update to
// any open OBS view over the /chat WS — see backend/overlay/custom.html.
export default function OverlayCanvas({ layoutId }) {
  const [layers, setLayers] = useState([]);
  const [assets, setAssets] = useState([]);
  const [token, setToken] = useState("");
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [fitScale, setFitScale] = useState(0.25);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved
  const [uploading, setUploading] = useState(false);

  const viewportRef = useRef(null);
  const saveTimerRef = useRef(null);
  const layersRef = useRef(layers);
  layersRef.current = layers;

  const refreshAssets = useCallback(() => {
    apiFetch("/overlay-builder/assets").then((r) => r.json()).then((data) => setAssets(data.assets || []));
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
        if (!res.ok) return window.alert(data.error || "Upload failed");
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
      if (!res.ok) return window.alert(data.error || "Upload failed");
      refreshAssets();
      addLayer({ id: uid(), type: "video", assetId: data.asset.id, loop: true, muted: true, x: 100, y: 100, w: 640, h: 360 });
    } finally {
      setUploading(false);
    }
  };

  const addText = () => {
    addLayer({ id: uid(), type: "text", text: "New Text", fontSize: 48, color: "#ffffff", bold: false, align: "left", x: 100, y: 100, w: 500, h: 100 });
  };

  const deleteAsset = async (assetId) => {
    if (!window.confirm("Delete this asset? Any layers using it will be removed too.")) return;
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
        onAddText={addText}
        uploading={uploading}
        saveState={saveState}
      />
      <div style={styles.editorArea}>
        <div ref={viewportRef} style={styles.viewport}>
          <div
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              transform: `scale(${fitScale})`,
              transformOrigin: "top left",
              position: "relative",
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
                style={{ outline: layer.id === selectedLayerId ? "2px solid #9147ff" : "1px dashed rgba(255,255,255,0.35)" }}
              >
                <LayerContent layer={layer} assetUrl={assetUrl} />
              </Rnd>
            ))}
          </div>
        </div>

        <div style={styles.sidebar}>
          <PropertyPanel
            layer={selectedLayer}
            onChange={(patch) => selectedLayer && updateLayer(selectedLayer.id, patch)}
            onDelete={() => selectedLayer && removeLayer(selectedLayer.id)}
            onReorder={(dir) => selectedLayer && reorderLayer(selectedLayer.id, dir)}
          />
          <AssetsSidebar assets={assets} assetUrl={assetUrl} onDelete={deleteAsset} />
        </div>
      </div>
    </div>
  );
}

function LayerContent({ layer, assetUrl }) {
  if (layer.type === "image") {
    return <img src={assetUrl(layer.assetId)} alt="" style={styles.layerMedia} draggable={false} />;
  }
  if (layer.type === "video") {
    return (
      <video
        src={assetUrl(layer.assetId)}
        style={styles.layerMedia}
        autoPlay
        loop={layer.loop !== false}
        muted={layer.muted !== false}
        playsInline
      />
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
      {layer.text}
    </div>
  );
}

function Toolbar({ onAddImage, onAddVideo, onAddText, uploading, saveState }) {
  const imageInputRef = useRef(null);
  const videoInputRef = useRef(null);

  return (
    <div style={styles.toolbar}>
      <button style={styles.toolBtn} disabled={uploading} onClick={() => imageInputRef.current?.click()}>🖼️ Add Image</button>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files[0]) onAddImage(e.target.files[0]); e.target.value = ""; }}
      />
      <button style={styles.toolBtn} disabled={uploading} onClick={() => videoInputRef.current?.click()}>🎬 Add Video</button>
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/webm"
        style={{ display: "none" }}
        onChange={(e) => { if (e.target.files[0]) onAddVideo(e.target.files[0]); e.target.value = ""; }}
      />
      <button style={styles.toolBtn} onClick={onAddText}>🔤 Add Text</button>
      <div style={styles.saveIndicator}>
        {uploading ? "Uploading…" : saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
      </div>
    </div>
  );
}

function PropertyPanel({ layer, onChange, onDelete, onReorder }) {
  if (!layer) {
    return (
      <div style={styles.panel}>
        <div style={styles.panelTitle}>Properties</div>
        <div style={styles.panelEmpty}>Select a layer to edit it.</div>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.panelTitle}>Properties — {layer.type}</div>

      {layer.type === "text" && (
        <>
          <label style={styles.label}>Text
            <textarea
              style={styles.textarea}
              value={layer.text}
              onChange={(e) => onChange({ text: e.target.value })}
              rows={3}
            />
          </label>
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

      {layer.type === "video" && (
        <>
          <label style={styles.checkboxLabel}>
            <input type="checkbox" checked={layer.loop !== false} onChange={(e) => onChange({ loop: e.target.checked })} />
            Loop
          </label>
          <label style={styles.checkboxLabel}>
            <input type="checkbox" checked={layer.muted !== false} onChange={(e) => onChange({ muted: e.target.checked })} />
            Muted
          </label>
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
        <button style={styles.toolBtn} onClick={() => onReorder("back")}>⬇️ Send back</button>
        <button style={styles.toolBtn} onClick={() => onReorder("front")}>⬆️ Bring front</button>
      </div>
      <button style={styles.deleteBtn} onClick={onDelete}>🗑️ Delete layer</button>
    </div>
  );
}

function AssetsSidebar({ assets, assetUrl, onDelete }) {
  return (
    <div style={styles.panel}>
      <div style={styles.panelTitle}>Media Library</div>
      {assets.length === 0 && <div style={styles.panelEmpty}>No uploads yet.</div>}
      <div style={styles.assetGrid}>
        {assets.map((a) => (
          <div key={a.id} style={styles.assetCard}>
            {a.kind === "image" ? (
              <img src={assetUrl(a.id)} alt="" style={styles.assetThumb} />
            ) : (
              <div style={styles.assetThumbVideo}>🎬</div>
            )}
            <div style={styles.assetMeta}>{formatBytes(a.sizeBytes)}</div>
            <button style={styles.assetDeleteBtn} onClick={() => onDelete(a.id)} title="Delete">✕</button>
          </div>
        ))}
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
    color: "var(--purple-light)",
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
};
