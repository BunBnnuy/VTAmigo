import React, { useState, useEffect } from "react";
import { apiFetch } from "./api.js";

function Toggle({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        ...styles.toggle,
        background: checked ? "var(--purple)" : "var(--border)",
      }}
    >
      <span
        style={{
          ...styles.toggleKnob,
          transform: checked ? "translateX(16px)" : "translateX(0)",
        }}
      />
    </button>
  );
}

export default function VideoQueue({ videoState }) {
  const [collapsed, setCollapsed] = useState(false);
  const [overlayUrl, setOverlayUrl] = useState("");
  const [overlayCopied, setOverlayCopied] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [playlistInput, setPlaylistInput] = useState("");
  const [playlistSaving, setPlaylistSaving] = useState(false);
  const [playlistError, setPlaylistError] = useState("");
  const [playlistCount, setPlaylistCount] = useState(null);

  useEffect(() => {
    apiFetch("/video/overlay-url")
      .then((res) => res.json())
      .then((data) => setOverlayUrl(data.url || ""))
      .catch(() => {});
  }, []);

  const copyOverlayUrl = async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setOverlayCopied(true);
      setTimeout(() => setOverlayCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can still copy manually.
    }
  };

  const addToQueue = async (e) => {
    e.preventDefault();
    const input = addInput.trim();
    if (!input) return;
    setAdding(true);
    setAddError("");
    try {
      const res = await apiFetch("/video/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAddInput("");
    } catch (err) {
      setAddError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const removeItem = (id) => {
    apiFetch(`/video/queue/${id}`, { method: "DELETE" }).catch(() => {});
  };

  const skip = () => {
    apiFetch("/video/skip", { method: "POST" }).catch(() => {});
  };

  const previous = () => {
    apiFetch("/video/previous", { method: "POST" }).catch(() => {});
  };

  const togglePlayPause = () => {
    const action = videoState?.nowPlaying?.paused ? "play" : "pause";
    apiFetch("/video/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
  };

  const updateSetting = (key, value) => {
    apiFetch("/video/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: value }),
    }).catch(() => {});
  };

  const saveDefaultPlaylist = async (e) => {
    e.preventDefault();
    const input = playlistInput.trim();
    if (!input) return;
    setPlaylistSaving(true);
    setPlaylistError("");
    try {
      const res = await apiFetch("/video/default-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setPlaylistCount(data.count);
      setPlaylistInput("");
    } catch (err) {
      setPlaylistError(err.message);
    } finally {
      setPlaylistSaving(false);
    }
  };

  const nowPlaying = videoState?.nowPlaying || null;
  const queue = videoState?.queue || [];

  if (collapsed) {
    return (
      <div style={styles.collapsedPanel}>
        <button style={styles.collapseBtn} onClick={() => setCollapsed(false)} title="Expandir cola de videos">
          ⟨
        </button>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Cola de Videos</span>
        <button style={styles.collapseBtn} onClick={() => setCollapsed(true)} title="Colapsar cola de videos">
          ⟩
        </button>
      </div>
      <div style={styles.body}>
        <button style={styles.actionBtn} onClick={copyOverlayUrl} disabled={!overlayUrl} title="Copiar la URL del overlay de video para OBS">
          {overlayCopied ? "✓ Copiado" : "🔗 Copiar overlay"}
        </button>

        <div style={styles.divider} />

        <div style={styles.row}>
          <span style={styles.rowLabel}>Peticiones de espectadores (!sr)</span>
          <Toggle
            checked={videoState?.viewerRequestsEnabled !== false}
            onChange={() => updateSetting("viewerRequestsEnabled", !(videoState?.viewerRequestsEnabled !== false))}
          />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>Saltar canción por defecto al pedir</span>
          <Toggle
            checked={!!videoState?.skipDefaultOnRequest}
            onChange={() => updateSetting("skipDefaultOnRequest", !videoState?.skipDefaultOnRequest)}
          />
        </div>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>Reproduciendo ahora</div>
        {nowPlaying ? (
          <div style={styles.nowPlaying}>
            {nowPlaying.thumbnail && <img src={nowPlaying.thumbnail} alt="" style={styles.thumb} />}
            <span style={styles.nowPlayingTitle}>{nowPlaying.title}</span>
          </div>
        ) : (
          <span style={styles.emptyText}>Nada en reproducción</span>
        )}
        <div style={styles.mediaControls}>
          <button style={styles.mediaBtn} onClick={previous} title="Video anterior">
            ⏮
          </button>
          <button style={styles.mediaBtn} onClick={togglePlayPause} disabled={!nowPlaying} title={nowPlaying?.paused ? "Reanudar" : "Pausar"}>
            {nowPlaying?.paused ? "▶" : "⏸"}
          </button>
          <button style={styles.mediaBtn} onClick={skip} disabled={!nowPlaying} title="Siguiente video">
            ⏭
          </button>
        </div>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>Agregar a la cola</div>
        <form onSubmit={addToQueue} style={styles.field}>
          <input
            type="text"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder="URL, ID o título de YouTube"
            style={styles.input}
          />
          <button type="submit" style={styles.actionBtn} disabled={adding || !addInput.trim()}>
            {adding ? "Buscando…" : "➕ Agregar"}
          </button>
          {addError && <span style={styles.errorText}>⚠ {addError}</span>}
        </form>

        {queue.length > 0 && (
          <div style={styles.queueList}>
            {queue.map((item) => (
              <div key={item.id} style={styles.queueItem}>
                <span style={styles.queueItemTitle} title={item.title}>{item.title}</span>
                {item.requestedBy && <span style={styles.queueItemBy}>{item.requestedBy}</span>}
                <button style={styles.smallBtn} onClick={() => removeItem(item.id)} title="Quitar de la cola">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>Playlist por defecto</div>
        <span style={styles.hint2}>
          Se reproduce en bucle cuando la cola está vacía{playlistCount != null ? ` (${playlistCount} videos)` : ""}
        </span>
        <form onSubmit={saveDefaultPlaylist} style={styles.field}>
          <input
            type="text"
            value={playlistInput}
            onChange={(e) => setPlaylistInput(e.target.value)}
            placeholder="URL o ID de playlist de YouTube"
            style={styles.input}
          />
          <button type="submit" style={styles.actionBtn} disabled={playlistSaving || !playlistInput.trim()}>
            {playlistSaving ? "Guardando…" : "💾 Guardar"}
          </button>
          {playlistError && <span style={styles.errorText}>⚠ {playlistError}</span>}
        </form>
      </div>
      <div style={styles.hint}>Los espectadores también pueden pedir canciones con !sr</div>
    </div>
  );
}

const styles = {
  panel: {
    width: 240,
    minWidth: 200,
    display: "flex",
    flexDirection: "column",
    borderLeft: "1px solid var(--border)",
    background: "var(--surface)",
    overflow: "hidden",
    flexShrink: 0,
  },
  collapsedPanel: {
    width: 28,
    minWidth: 28,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    borderLeft: "1px solid var(--border)",
    background: "var(--surface)",
    flexShrink: 0,
    paddingTop: 10,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  title: {
    fontWeight: 700,
    fontSize: 13,
  },
  collapseBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    fontSize: 12,
    padding: "3px 7px",
  },
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: "14px 12px",
    overflowY: "auto",
  },
  divider: {
    height: 1,
    background: "var(--border)",
    margin: "2px 0",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowLabel: {
    fontSize: 12,
    color: "var(--text)",
  },
  toggle: {
    width: 34,
    height: 18,
    borderRadius: 9,
    padding: 2,
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
  toggleKnob: {
    width: 14,
    height: 14,
    borderRadius: "50%",
    background: "#fff",
    transition: "transform 0.15s",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  actionBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 10px",
    textAlign: "left",
  },
  nowPlaying: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  thumb: {
    width: 48,
    height: 27,
    objectFit: "cover",
    borderRadius: 4,
    flexShrink: 0,
  },
  mediaControls: {
    display: "flex",
    gap: 6,
  },
  mediaBtn: {
    flex: 1,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 14,
    padding: "6px 0",
    textAlign: "center",
  },
  nowPlayingTitle: {
    fontSize: 12,
    color: "var(--text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  emptyText: {
    fontSize: 12,
    color: "var(--text-muted)",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  input: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 4,
  },
  errorText: {
    fontSize: 10,
    color: "var(--red)",
  },
  queueList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    maxHeight: 180,
    overflowY: "auto",
  },
  queueItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11,
  },
  queueItemTitle: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: "var(--text)",
  },
  queueItemBy: {
    color: "var(--text-muted)",
    flexShrink: 0,
  },
  smallBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 11,
    padding: "0 6px",
    flexShrink: 0,
  },
  hint2: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
  },
};
