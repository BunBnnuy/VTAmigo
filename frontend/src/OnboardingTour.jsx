import React, { useLayoutEffect, useState } from "react";
import { useTranslation } from "./i18n/index.js";

// Steps are driven by index. Steps 3 ("settings-btn") and 6 ("save-apply")
// have no Next button — the user must perform the real action (App.jsx
// wires those clicks to call onAdvance itself). Step 5 ("ai-prompt") insists
// up to 3 times via `attempts` before Next is allowed to move on. Text for
// each step lives under the "onboarding.steps.<key>" i18n namespace.
const STEPS = [
  { target: "live-chat", key: "liveChat" },
  { target: "ai-response", key: "aiResponse" },
  { target: "status-footer", key: "statusFooter" },
  { target: "settings-btn", key: "openSettings", requiresClick: true },
  { target: "bot-account", key: "botAccount" },
  { target: "ai-prompt", key: "aiPrompt", insist: true },
  { target: "save-apply", key: "saveApply", requiresClick: true },
  { target: null, key: "done", final: true },
];

const PAD = 8;

export default function OnboardingTour({ lang, step, attempts, onNext, onSkipStep, onSkipAll, onFinish }) {
  const { t } = useTranslation(lang);
  const [rect, setRect] = useState(null);
  const s = STEPS[step];

  useLayoutEffect(() => {
    if (!s || !s.target) {
      setRect(null);
      return;
    }
    const el = document.querySelector(`[data-tour="${s.target}"]`);
    if (!el) {
      setRect(null);
      return;
    }
    el.scrollIntoView({ block: "center" });
    const update = () => {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
    };
    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (!s) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const hole = rect
    ? {
        top: Math.max(0, rect.top - PAD),
        left: Math.max(0, rect.left - PAD),
        right: Math.min(vw, rect.right + PAD),
        bottom: Math.min(vh, rect.bottom + PAD),
      }
    : null;

  // Tooltip placement: try below, then above, then beside (right, then left) the
  // hole — whichever has enough clear room — so the card never sits on top of
  // the highlighted element itself. Falls back to a clamped "below" as a last resort.
  const tooltipWidth = 340;
  const tooltipHeightEstimate = 200;
  let tooltipStyle = { ...styles.tooltip };
  if (hole) {
    const spaceBelow = vh - hole.bottom;
    const spaceAbove = hole.top;
    const spaceRight = vw - hole.right;
    const spaceLeft = hole.left;
    const hLeft = Math.min(Math.max(hole.left, 12), vw - tooltipWidth - 12);
    const vTop = Math.min(Math.max(hole.top, 12), vh - tooltipHeightEstimate - 12);

    if (spaceBelow >= tooltipHeightEstimate) {
      tooltipStyle = { ...tooltipStyle, top: hole.bottom + 14, left: hLeft };
    } else if (spaceAbove >= tooltipHeightEstimate) {
      tooltipStyle = { ...tooltipStyle, bottom: vh - hole.top + 14, left: hLeft };
    } else if (spaceRight >= tooltipWidth + 24) {
      tooltipStyle = { ...tooltipStyle, top: vTop, left: hole.right + 14 };
    } else if (spaceLeft >= tooltipWidth + 24) {
      tooltipStyle = { ...tooltipStyle, top: vTop, right: vw - hole.left + 14 };
    } else {
      tooltipStyle = {
        ...tooltipStyle,
        top: Math.min(hole.bottom + 14, vh - tooltipHeightEstimate - 12),
        left: hLeft,
      };
    }
  } else {
    tooltipStyle = {
      ...tooltipStyle,
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const title = t(`onboarding.steps.${s.key}.title`);
  const body = s.insist
    ? t(`onboarding.steps.${s.key}.insist${Math.min(attempts, 2) + 1}`)
    : t(`onboarding.steps.${s.key}.body`);

  return (
    <div style={styles.root}>
      {hole ? (
        <>
          <div style={{ ...styles.dim, top: 0, left: 0, right: 0, height: hole.top }} />
          <div style={{ ...styles.dim, top: hole.bottom, left: 0, right: 0, bottom: 0 }} />
          <div style={{ ...styles.dim, top: hole.top, left: 0, width: hole.left, height: hole.bottom - hole.top }} />
          <div style={{ ...styles.dim, top: hole.top, left: hole.right, right: 0, height: hole.bottom - hole.top }} />
          <div
            style={{
              ...styles.spotlightBorder,
              top: hole.top,
              left: hole.left,
              width: hole.right - hole.left,
              height: hole.bottom - hole.top,
            }}
          />
        </>
      ) : (
        <div style={{ ...styles.dim, inset: 0 }} />
      )}

      <div style={tooltipStyle}>
        <div style={styles.stepLabel}>{t("onboarding.stepLabel", { step: step + 1, total: STEPS.length })}</div>
        <div style={styles.title}>{title}</div>
        <div style={styles.body}>{body}</div>
        <div style={styles.actions}>
          {s.final ? (
            <button style={styles.primaryBtn} onClick={onFinish}>{t("onboarding.buttons.gotIt")}</button>
          ) : (
            <>
              <div style={styles.leftActions}>
                <button style={styles.textBtn} onClick={onSkipStep}>{t("onboarding.buttons.skipStep")}</button>
                <button style={styles.textBtn} onClick={onSkipAll}>{t("onboarding.buttons.skipAll")}</button>
              </div>
              {!s.requiresClick && (
                <button style={styles.primaryBtn} onClick={onNext}>{t("onboarding.buttons.next")}</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  root: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
  },
  dim: {
    position: "fixed",
    background: "rgba(0,0,0,0.72)",
    pointerEvents: "auto",
  },
  spotlightBorder: {
    position: "fixed",
    border: "2px solid var(--accent)",
    borderRadius: 8,
    boxShadow: "0 0 0 3px rgba(168, 85, 247, 0.25)",
    pointerEvents: "none",
  },
  tooltip: {
    position: "fixed",
    width: 340,
    maxWidth: "90vw",
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "14px 16px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    pointerEvents: "auto",
  },
  stepLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  title: {
    fontWeight: 700,
    fontSize: 15,
    marginBottom: 6,
  },
  body: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text)",
    marginBottom: 14,
  },
  actions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  leftActions: {
    display: "flex",
    gap: 12,
  },
  textBtn: {
    background: "transparent",
    color: "var(--text-muted)",
    fontSize: 12,
    padding: "4px 0",
  },
  primaryBtn: {
    background: "var(--accent)",
    color: "var(--on-accent)",
    fontSize: 13,
    fontWeight: 600,
    padding: "6px 14px",
    borderRadius: 6,
    marginLeft: "auto",
  },
};
