import React, { useState, useEffect, useRef } from "react";
import { apiFetch } from "./api.js";
import { useTranslation } from "./i18n/index.js";

// Stage sizes the preview can emulate — the overlay page sizes itself off the
// viewport (vw/vh units, `min(maxHeight, 96vh)`), so the iframe has to be a
// real OBS-canvas-sized box that we scale down to fit the panel, rather than
// just letting it fill whatever width the window happens to be.
const STAGES = [
  { id: "1080p", w: 1920, h: 1080 },
  { id: "720p", w: 1280, h: 720 },
];

// Content only — outer window chrome (drag/resize/collapse) is provided by
// WindowManager.jsx's shared <Window>.
//
// `visible` is false while the window is collapsed (and the whole component is
// unmounted by WindowManager when the window is closed). Everything expensive —
// the overlay <iframe>, which is a full second document with its own WebSocket
// to the backend and its own animation timers — hangs off that flag, so a
// collapsed or closed preview costs nothing. Remounting it on expand is a
// deliberate cold start: the overlay renders live chat only, so there is no
// scrollback to lose.
export default function ChatOverlayPreview({ lang, visible }) {
  const { t } = useTranslation(lang);

  const [overlayUrl, setOverlayUrl] = useState("");
  const [stageId, setStageId] = useState(STAGES[0].id);
  const [reloadKey, setReloadKey] = useState(0);
  const [scale, setScale] = useState(0);
  const stageWrapRef = useRef(null);

  const stage = STAGES.find((s) => s.id === stageId) || STAGES[0];

  // Deferred until the panel is actually shown, so a dashboard that starts
  // with this window collapsed never even asks for the URL.
  useEffect(() => {
    if (!visible || overlayUrl) return;
    let cancelled = false;
    apiFetch("/chat-overlay/overlay-url")
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setOverlayUrl(data.url || "");
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visible, overlayUrl]);

  // Fit the fixed-size stage into whatever width the window has been dragged
  // to. Scale starts at 0 so the iframe isn't painted at full 1920px for a
  // frame before the first measurement lands.
  useEffect(() => {
    const el = stageWrapRef.current;
    if (!visible || !el) return;
    const measure = () => setScale(el.clientWidth / stage.w);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible, stage.w]);

  // Fake data, broadcast only to this account's overlay(s) — the same routes
  // the Chat Overlay settings panel uses. Handy here because a quiet chat
  // otherwise leaves the preview empty.
  const sendTest = async (kind) => {
    try {
      await apiFetch(`/chat-overlay/test-${kind}`, { method: "POST" });
    } catch {
      // Best-effort preview helper — nothing to show the user on failure.
    }
  };

  if (!visible) return null;

  return (
    <>
      <div style={styles.body}>
        <div style={styles.toolbar}>
          <select
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            style={styles.select}
            title={t("chatOverlayPreview.stageTitle")}
          >
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>{`${s.w}×${s.h}`}</option>
            ))}
          </select>
          <button type="button" style={styles.smallBtn} onClick={() => setReloadKey((k) => k + 1)}>
            {t("chatOverlayPreview.reload")}
          </button>
          <span style={styles.scaleLabel}>{Math.round(scale * 100)}%</span>
        </div>

        <div style={styles.row3}>
          <button type="button" style={styles.smallBtn} onClick={() => sendTest("message")}>
            {t("chatOverlayPreview.testMessage")}
          </button>
          <button type="button" style={styles.smallBtn} onClick={() => sendTest("redeem")}>
            {t("chatOverlayPreview.testRedeem")}
          </button>
          <button type="button" style={styles.smallBtn} onClick={() => sendTest("event")}>
            {t("chatOverlayPreview.testEvent")}
          </button>
        </div>

        {/* Checkerboard stands in for the transparent overlay background, the
            way OBS shows it before anything is composited underneath. */}
        <div ref={stageWrapRef} style={styles.stageWrap}>
          <div style={{ ...styles.stage, height: scale ? stage.h * scale : 0 }}>
            {overlayUrl && scale > 0 && (
              <iframe
                key={`${overlayUrl}-${stageId}-${reloadKey}`}
                src={overlayUrl}
                title={t("chatOverlayPreview.title")}
                scrolling="no"
                style={{
                  ...styles.frame,
                  width: stage.w,
                  height: stage.h,
                  transform: `scale(${scale})`,
                }}
              />
            )}
          </div>
        </div>
      </div>
      <div style={styles.hint}>{t("chatOverlayPreview.hint")}</div>
    </>
  );
}

const styles = {
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "10px 12px",
    overflowY: "auto",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  select: {
    flex: 1,
    minWidth: 0,
  },
  row3: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 6,
  },
  smallBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 11,
    padding: "5px 8px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  scaleLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  },
  stageWrap: {
    width: "100%",
  },
  stage: {
    position: "relative",
    width: "100%",
    overflow: "hidden",
    borderRadius: 6,
    border: "1px solid var(--border)",
    backgroundColor: "#2a2a2e",
    backgroundImage:
      "linear-gradient(45deg, #3a3a3f 25%, transparent 25%, transparent 75%, #3a3a3f 75%)," +
      "linear-gradient(45deg, #3a3a3f 25%, transparent 25%, transparent 75%, #3a3a3f 75%)",
    backgroundSize: "16px 16px",
    backgroundPosition: "0 0, 8px 8px",
  },
  frame: {
    position: "absolute",
    top: 0,
    left: 0,
    border: "none",
    transformOrigin: "top left",
    // The overlay is a live view of chat, not something to interact with —
    // clicks would only ever land on it by accident while dragging.
    pointerEvents: "none",
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
  },
};
