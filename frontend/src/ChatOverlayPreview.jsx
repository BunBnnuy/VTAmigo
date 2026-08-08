import React, { useState, useEffect, useRef } from "react";
import { apiFetch } from "./api.js";
import { useTranslation } from "./i18n/index.js";

// Matches the width/maxHeight fields in ChatOverlayPanel.jsx's DEFAULTS —
// used only until the real config loads.
const DEFAULT_SIZE = { width: 420, maxHeight: 600 };

// The overlay is built to sit inside a canvas much bigger than the feed
// itself (a real OBS browser source) — #feed is anchored with a 1.2vw/1.2vh
// offset from the edges, adds its own padding (30/20px for the bubble
// theme), and the bubble theme's flowers/badge tag deliberately overflow the
// bubble's own box by up to ~20px. If the iframe viewport were exactly
// width×maxHeight, that extra footprint gets clipped by the page's
// `overflow: hidden` — losing the border, flowers and badge entirely. These
// margins give the feed the same kind of breathing room a real OBS canvas
// would, at every size the Appearance panel allows (width 200–1200,
// maxHeight 100–3000): X_MARGIN covers the 1.2vw offset + padding + overflow;
// Y_MARGIN is large enough that `min(maxHeight, 96vh)` never clamps below
// the configured maxHeight (96% of maxHeight+160 always exceeds maxHeight),
// plus the same offset/decoration room vertically.
const STAGE_MARGIN_X = 120;
const STAGE_MARGIN_Y = 160;

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
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [reloadKey, setReloadKey] = useState(0);
  const [scale, setScale] = useState(0);
  const stageWrapRef = useRef(null);

  const contentW = size.width || DEFAULT_SIZE.width;
  const contentH = size.maxHeight || DEFAULT_SIZE.maxHeight;
  // The iframe itself is padded out by the stage margins above; the feed
  // content box inside it still comes out to exactly contentW × contentH,
  // which is what gets shown in the size caption below.
  const stage = { w: contentW + STAGE_MARGIN_X, h: contentH + STAGE_MARGIN_Y };

  // Deferred until the panel is actually shown, so a dashboard that starts
  // with this window collapsed never even asks for anything. The overlay URL
  // only needs fetching once, but the width/maxHeight config is re-fetched
  // every time the panel opens (and on Reload) so a size change made in the
  // Chat Overlay panel — possibly minutes ago, possibly in another tab — is
  // picked up without needing a live subscription.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    if (!overlayUrl) {
      apiFetch("/chat-overlay/overlay-url")
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) setOverlayUrl(data.url || "");
        })
        .catch(() => {});
    }
    apiFetch("/chat-overlay/config")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const cfg = data.config || {};
        setSize({ width: cfg.width || DEFAULT_SIZE.width, maxHeight: cfg.maxHeight || DEFAULT_SIZE.maxHeight });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visible, overlayUrl, reloadKey]);

  // Fit the fixed-size stage into whatever width the window has been dragged
  // to. Scale starts at 0 so the iframe isn't painted at full size for a
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
          <span style={styles.sizeCaption} title={t("chatOverlayPreview.sizeCaptionTitle")}>
            {t("chatOverlayPreview.sizeCaption", { width: contentW, height: contentH })}
          </span>
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
                key={`${overlayUrl}-${stage.w}x${stage.h}-${reloadKey}`}
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
  sizeCaption: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
