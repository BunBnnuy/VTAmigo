import React, { useState, useEffect } from "react";
import { apiFetch } from "./api.js";
import { useTranslation } from "./i18n/index.js";

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

// Content only — outer window chrome (drag/resize/collapse) is provided by
// WindowManager.jsx's shared <Window>.
export default function VideoQueue({ videoState, lang }) {
  const { t } = useTranslation(lang);
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

  const [copiedVideoId, setCopiedVideoId] = useState(null);

  const copyVideoUrl = async (videoId) => {
    if (!videoId) return;
    try {
      await navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${videoId}`);
      setCopiedVideoId(videoId);
      setTimeout(() => setCopiedVideoId((cur) => (cur === videoId ? null : cur)), 1500);
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
  const history = videoState?.history || [];
  const defaultPlaylistId = videoState?.defaultPlaylistId || null;
  const defaultPlaylistCache = videoState?.defaultPlaylistCache || null;
  const nextDefaultItem =
    defaultPlaylistCache && defaultPlaylistCache.items.length > 0
      ? defaultPlaylistCache.items[defaultPlaylistCache.index % defaultPlaylistCache.items.length]
      : null;

  return (
    <>
      <div style={styles.body}>
        <button style={styles.actionBtn} onClick={copyOverlayUrl} disabled={!overlayUrl} title={t("videoQueue.copyOverlayTitle")}>
          {overlayCopied ? t("videoQueue.copied") : t("videoQueue.copyOverlay")}
        </button>

        <div style={styles.divider} />

        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("videoQueue.viewerRequests")}</span>
          <Toggle
            checked={videoState?.viewerRequestsEnabled !== false}
            onChange={() => updateSetting("viewerRequestsEnabled", !(videoState?.viewerRequestsEnabled !== false))}
          />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("videoQueue.skipDefaultOnRequest")}</span>
          <Toggle
            checked={!!videoState?.skipDefaultOnRequest}
            onChange={() => updateSetting("skipDefaultOnRequest", !videoState?.skipDefaultOnRequest)}
          />
        </div>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("videoQueue.nowPlayingSection")}</div>
        {nowPlaying ? (
          <div style={styles.nowPlaying}>
            {nowPlaying.thumbnail && <img src={nowPlaying.thumbnail} alt="" style={styles.thumb} />}
            <span style={styles.nowPlayingTitle}>{nowPlaying.title}</span>
            <button
              style={styles.copyIconBtn}
              onClick={() => copyVideoUrl(nowPlaying.videoId)}
              title={t("videoQueue.copyVideoTitle")}
            >
              {copiedVideoId === nowPlaying.videoId ? "✓" : "🔗"}
            </button>
          </div>
        ) : (
          <span style={styles.emptyText}>{t("videoQueue.nothingPlaying")}</span>
        )}
        <div style={styles.mediaControls}>
          <button style={styles.mediaBtn} onClick={previous} title={t("videoQueue.previousTitle")}>
            ⏮
          </button>
          <button style={styles.mediaBtn} onClick={togglePlayPause} disabled={!nowPlaying} title={nowPlaying?.paused ? t("videoQueue.resumeTitle") : t("videoQueue.pauseTitle")}>
            {nowPlaying?.paused ? "▶" : "⏸"}
          </button>
          <button style={styles.mediaBtn} onClick={skip} disabled={!nowPlaying} title={t("videoQueue.nextTitle")}>
            ⏭
          </button>
        </div>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("videoQueue.addSection")}</div>
        <form onSubmit={addToQueue} style={styles.field}>
          <input
            type="text"
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            placeholder={t("videoQueue.addPlaceholder")}
            style={styles.input}
          />
          <button type="submit" style={styles.actionBtn} disabled={adding || !addInput.trim()}>
            {adding ? t("videoQueue.searching") : t("videoQueue.addButton")}
          </button>
          {addError && <span style={styles.errorText}>⚠ {addError}</span>}
        </form>

        {queue.length > 0 && (
          <div style={styles.queueList}>
            {queue.map((item) => (
              <div key={item.id} style={styles.queueItem}>
                <span style={styles.queueItemTitle} title={item.title}>{item.title}</span>
                {item.requestedBy && <span style={styles.queueItemBy}>{item.requestedBy}</span>}
                <button
                  style={styles.copyIconBtnSmall}
                  onClick={() => copyVideoUrl(item.videoId)}
                  title={t("videoQueue.copyVideoTitle")}
                >
                  {copiedVideoId === item.videoId ? "✓" : "🔗"}
                </button>
                <button style={styles.smallBtn} onClick={() => removeItem(item.id)} title={t("videoQueue.removeTitle")}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("videoQueue.defaultPlaylistSection")}</div>
        <span style={styles.hint2}>
          {t("videoQueue.defaultPlaylistHint", {
            countSuffix: playlistCount != null ? t("videoQueue.videosCountSuffix", { count: playlistCount }) : "",
          })}
        </span>

        {defaultPlaylistId && (
          <div style={styles.defaultPlaylistInfo}>
            <span style={styles.defaultPlaylistTitle} title={videoState?.defaultPlaylistTitle || defaultPlaylistId}>
              {videoState?.defaultPlaylistTitle || defaultPlaylistId}
            </span>
            <a
              href={`https://www.youtube.com/playlist?list=${defaultPlaylistId}`}
              target="_blank"
              rel="noreferrer"
              style={{ ...styles.actionBtn, display: "block", textDecoration: "none", boxSizing: "border-box" }}
            >
              {t("videoQueue.viewOnYoutube")}
            </a>
            {nextDefaultItem && (
              <span style={styles.hint2} title={nextDefaultItem.title}>
                {t("videoQueue.nextInPlaylist", { title: nextDefaultItem.title })}
              </span>
            )}
          </div>
        )}

        <form onSubmit={saveDefaultPlaylist} style={styles.field}>
          <input
            type="text"
            value={playlistInput}
            onChange={(e) => setPlaylistInput(e.target.value)}
            placeholder={t("videoQueue.playlistPlaceholder")}
            style={styles.input}
          />
          <button type="submit" style={styles.actionBtn} disabled={playlistSaving || !playlistInput.trim()}>
            {playlistSaving ? t("videoQueue.saving") : t("videoQueue.saveButton")}
          </button>
          {playlistError && <span style={styles.errorText}>⚠ {playlistError}</span>}
        </form>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("videoQueue.historySection")}</div>
        {history.length > 0 ? (
          <div style={styles.queueList}>
            {[...history].reverse().map((item, i) => (
              <div key={`${item.videoId}-${item.startedAt || i}`} style={styles.queueItem}>
                <span style={styles.queueItemTitle} title={item.title}>{item.title}</span>
                <button
                  style={styles.copyIconBtnSmall}
                  onClick={() => copyVideoUrl(item.videoId)}
                  title={t("videoQueue.copyVideoTitle")}
                >
                  {copiedVideoId === item.videoId ? "✓" : "🔗"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <span style={styles.emptyText}>{t("videoQueue.noHistory")}</span>
        )}
      </div>
      <div style={styles.hint}>{t("videoQueue.footerHint")}</div>
    </>
  );
}

const styles = {
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
  copyIconBtn: {
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    fontSize: 12,
    padding: "2px 4px",
    flexShrink: 0,
    cursor: "pointer",
  },
  copyIconBtnSmall: {
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    fontSize: 11,
    padding: "0 4px",
    flexShrink: 0,
    cursor: "pointer",
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
  defaultPlaylistInfo: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  defaultPlaylistTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
  },
};
