import React from "react";
import { ListMusic, Megaphone, Play, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { countUnplayed, previewBeats } from "./showScript.js";
import { useTranslation } from "./i18n/index.js";

// Owner-only control window for the autonomous host. Everything here is
// stored in the normal settings blob (localStorage) and read by App.jsx at
// the moments that matter:
//
//   • cold open   — when the stream is detected live, before the first viewer.
//   • fast lane   — the <1s canned acknowledgement, so the first thing a new
//                   chatter hears is never the 15–30s AI round trip.
//   • first reply — short-circuit the batch window after a long silence.
//   • test buttons — fire each path on demand without waiting for a viewer.
//
// The panel itself is only mounted for role === "owner" (see WindowManager
// and App.jsx); the backend gates the VRM routes to the same role.

function Toggle({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{ ...styles.toggle, background: checked ? "var(--accent)" : "var(--border)" }}
    >
      <span
        style={{
          ...styles.toggleKnob,
          background: checked ? "var(--on-accent)" : "#fff",
          transform: checked ? "translateX(16px)" : "translateX(0)",
        }}
      />
    </button>
  );
}

export default function ShowRunnerPanel({
  settings,
  onUpdateSettings,
  onTestGreeting,
  onTestColdOpen,
  onTestAct,
  streamLive,
  scriptDecks = [],
  scriptState = {},
  onGenerateScript,
  onSpeakBeat,
  onDiscardDeck,
  lang,
}) {
  const { t } = useTranslation(lang);
  const host = settings.hostMode || {};
  const patch = (p) => onUpdateSettings({ hostMode: { ...host, ...p } });
  const pending = countUnplayed(scriptDecks);
  const preview = previewBeats(scriptDecks, Date.now(), 6);
  const generating = !!scriptState.generating;
  const KIND_KEYS = {
    open: "kindOpen",
    topic: "kindTopic",
    bridge: "kindBridge",
    question: "kindQuestion",
    recap: "kindRecap",
  };

  return (
    <div style={styles.body}>
      <div style={styles.ownerNote}>
        <Sparkles size={13} color="var(--accent)" />
        <span>{t("showRunnerPanel.ownerOnly")}</span>
      </div>

      <div style={styles.row}>
        <span style={styles.label}>{t("showRunnerPanel.enabled")}</span>
        <Toggle checked={!!host.enabled} onChange={() => patch({ enabled: !host.enabled })} />
      </div>
      <p style={styles.hint}>{t("showRunnerPanel.enabledHint")}</p>

      <div style={styles.section}>
        <div style={styles.sectionHead}>
          <span style={styles.sectionTitle}>
            <Megaphone size={13} color="var(--accent)" /> {t("showRunnerPanel.coldOpen")}
          </span>
          <Toggle
            checked={host.coldOpenEnabled !== false}
            onChange={() => patch({ coldOpenEnabled: host.coldOpenEnabled === false })}
          />
        </div>
        <textarea
          rows={3}
          value={host.coldOpenText || ""}
          onChange={(e) => patch({ coldOpenText: e.target.value })}
          style={styles.textarea}
          placeholder={t("showRunnerPanel.coldOpenPlaceholder")}
        />
        <p style={styles.hint}>{t("showRunnerPanel.coldOpenHint")}</p>
        <button style={styles.testBtn} onClick={onTestColdOpen}>
          <Play size={12} /> {t("showRunnerPanel.testColdOpen")}
          {streamLive ? "" : ` · ${t("showRunnerPanel.offline")}`}
        </button>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionHead}>
          <span style={styles.sectionTitle}>{t("showRunnerPanel.fastLane")}</span>
          <Toggle
            checked={host.fastLaneEnabled !== false}
            onChange={() => patch({ fastLaneEnabled: host.fastLaneEnabled === false })}
          />
        </div>
        <p style={styles.hint}>{t("showRunnerPanel.fastLaneHint")}</p>
        <textarea
          rows={4}
          value={host.fastLaneLines || ""}
          onChange={(e) => patch({ fastLaneLines: e.target.value })}
          style={styles.textarea}
          placeholder={t("showRunnerPanel.fastLanePlaceholder")}
        />
        <div style={styles.numRow}>
          <label style={styles.numLabel}>
            {t("showRunnerPanel.idleSeconds")}
            <input
              type="number"
              min={5}
              max={600}
              value={host.fastLaneIdleSec ?? 45}
              onChange={(e) => patch({ fastLaneIdleSec: Number(e.target.value) || 45 })}
              style={styles.numInput}
            />
          </label>
          <label style={styles.numLabel}>
            {t("showRunnerPanel.cooldownSeconds")}
            <input
              type="number"
              min={5}
              max={600}
              value={host.fastLaneCooldownSec ?? 30}
              onChange={(e) => patch({ fastLaneCooldownSec: Number(e.target.value) || 30 })}
              style={styles.numInput}
            />
          </label>
        </div>
        <button style={styles.testBtn} onClick={onTestGreeting}>
          <Play size={12} /> {t("showRunnerPanel.testGreeting")}
        </button>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionHead}>
          <span style={styles.sectionTitle}>
            <ListMusic size={13} color="var(--accent)" /> {t("showRunnerPanel.scriptSection")}
          </span>
          <Toggle
            checked={host.scriptEnabled !== false}
            onChange={() => patch({ scriptEnabled: host.scriptEnabled === false })}
          />
        </div>
        <p style={styles.hint}>{t("showRunnerPanel.scriptHint")}</p>

        <div style={styles.row}>
          <span style={styles.label}>{t("showRunnerPanel.scriptAuto")}</span>
          <Toggle
            checked={host.scriptAuto !== false}
            onChange={() => patch({ scriptAuto: host.scriptAuto === false })}
          />
        </div>

        <textarea
          rows={3}
          value={host.scriptNotes || ""}
          onChange={(e) => patch({ scriptNotes: e.target.value })}
          style={styles.textarea}
          placeholder={t("showRunnerPanel.scriptNotesPlaceholder")}
        />
        <p style={styles.hint}>{t("showRunnerPanel.scriptNotesHint")}</p>

        <div style={styles.numRow}>
          <label style={styles.numLabel}>
            {t("showRunnerPanel.scriptBeats")}
            <input
              type="number"
              min={6}
              max={20}
              value={host.scriptBeats ?? 14}
              onChange={(e) => patch({ scriptBeats: Number(e.target.value) || 14 })}
              style={styles.numInput}
            />
          </label>
          <label style={styles.numLabel}>
            {t("showRunnerPanel.scriptGap")}
            <input
              type="number"
              min={10}
              max={300}
              value={host.scriptGapSec ?? 45}
              onChange={(e) => patch({ scriptGapSec: Number(e.target.value) || 45 })}
              style={styles.numInput}
            />
          </label>
          <label style={styles.numLabel}>
            {t("showRunnerPanel.scriptEvery")}
            <input
              type="number"
              min={3}
              max={60}
              value={host.scriptEveryMin ?? 8}
              onChange={(e) => patch({ scriptEveryMin: Number(e.target.value) || 8 })}
              style={styles.numInput}
            />
          </label>
          <label style={styles.numLabel}>
            {t("showRunnerPanel.scriptLowWater")}
            <input
              type="number"
              min={1}
              max={12}
              value={host.scriptLowWater ?? 5}
              onChange={(e) => patch({ scriptLowWater: Number(e.target.value) || 5 })}
              style={styles.numInput}
            />
          </label>
        </div>

        <div style={styles.scriptStatus}>
          <span>
            {generating
              ? t("showRunnerPanel.scriptGenerating")
              : pending > 0
                ? t("showRunnerPanel.scriptPending", { count: pending })
                : t("showRunnerPanel.scriptEmpty")}
          </span>
          {scriptState.error ? (
            <span style={styles.scriptError}>{t("showRunnerPanel.scriptError", { error: scriptState.error })}</span>
          ) : null}
          {!streamLive ? <span>{t("showRunnerPanel.scriptOffline")}</span> : null}
        </div>

        <div style={styles.scriptActions}>
          <button style={styles.testBtn} onClick={onGenerateScript} disabled={generating}>
            <RefreshCw size={12} /> {generating ? t("showRunnerPanel.scriptGenerating") : t("showRunnerPanel.scriptGenerate")}
          </button>
          {preview[0] ? (
            <button style={styles.ghostBtn} onClick={() => onDiscardDeck(preview[0].deckId)}>
              <Trash2 size={12} /> {t("showRunnerPanel.scriptDiscard")}
            </button>
          ) : null}
        </div>

        {preview.length > 0 ? (
          <div style={styles.beatList}>
            {preview.map((beat) => (
              <div key={`${beat.deckId}-${beat.id}`} style={styles.beatRow}>
                <span style={styles.kindBadge}>
                  {t(`showRunnerPanel.${KIND_KEYS[beat.kind] || "kindTopic"}`)}
                </span>
                <span style={styles.beatText}>{beat.text}</span>
                <button
                  style={styles.sayBtn}
                  onClick={() => onSpeakBeat(beat.deckId, beat.id)}
                  title={t("showRunnerPanel.scriptSay")}
                >
                  <Play size={11} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div style={styles.section}>
        <div style={styles.sectionHead}>
          <span style={styles.sectionTitle}>{t("showRunnerPanel.firstReply")}</span>
          <Toggle
            checked={host.firstReplyFast !== false}
            onChange={() => patch({ firstReplyFast: host.firstReplyFast === false })}
          />
        </div>
        <p style={styles.hint}>{t("showRunnerPanel.firstReplyHint")}</p>
        <label style={styles.numLabel}>
          {t("showRunnerPanel.firstReplyDelay")}
          <input
            type="number"
            min={1}
            max={60}
            value={host.firstReplyDelaySec ?? 2}
            onChange={(e) => patch({ firstReplyDelaySec: Number(e.target.value) || 2 })}
            style={styles.numInput}
          />
        </label>
      </div>

      <button style={styles.testBtn} onClick={onTestAct}>
        <Sparkles size={12} /> {t("showRunnerPanel.testAct")}
      </button>
    </div>
  );
}

const styles = {
  body: { display: "flex", flexDirection: "column", gap: 10, padding: "14px 12px", overflowY: "auto" },
  ownerNote: {
    display: "flex", alignItems: "center", gap: 6,
    padding: "7px 9px", borderRadius: 8,
    background: "var(--surface2)", border: "1px solid var(--border)",
    color: "var(--text-muted)", fontSize: 11, lineHeight: 1.35,
  },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  label: { fontSize: 12, color: "var(--text)" },
  section: {
    display: "flex", flexDirection: "column", gap: 7,
    paddingTop: 10, borderTop: "1px solid var(--border)",
  },
  sectionHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  sectionTitle: {
    display: "inline-flex", alignItems: "center", gap: 5,
    fontFamily: "Quicksand, sans-serif", fontWeight: 600, fontSize: 12, color: "var(--text)",
  },
  hint: { margin: 0, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 },
  textarea: {
    width: "100%", boxSizing: "border-box", resize: "vertical",
    background: "var(--surface2)", color: "var(--text)",
    border: "1px solid var(--border)", borderRadius: 9,
    padding: "9px 12px", fontFamily: "Nunito, sans-serif", fontSize: 13, lineHeight: 1.4,
  },
  numRow: { display: "flex", gap: 12, flexWrap: "wrap" },
  numLabel: {
    display: "inline-flex", alignItems: "center", gap: 7,
    color: "var(--text-muted)", fontSize: 11,
  },
  numInput: {
    width: 64, background: "var(--surface2)", color: "var(--text)",
    border: "1px solid var(--border)", borderRadius: 9, padding: "7px 9px",
    fontFamily: "Nunito, sans-serif", fontSize: 13,
  },
  testBtn: {
    alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5,
    background: "transparent", color: "var(--accent)",
    border: "1.5px solid var(--accent)", borderRadius: 9,
    padding: "6px 10px", fontFamily: "Quicksand, sans-serif", fontSize: 11, fontWeight: 600,
    cursor: "pointer",
  },
  ghostBtn: {
    alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: 5,
    background: "transparent", color: "var(--text-muted)",
    border: "1px solid var(--border)", borderRadius: 9,
    padding: "6px 10px", fontFamily: "Quicksand, sans-serif", fontSize: 11, fontWeight: 600,
    cursor: "pointer",
  },
  scriptStatus: { display: "flex", flexDirection: "column", gap: 2, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.35 },
  scriptError: { color: "var(--red)" },
  scriptActions: { display: "flex", gap: 8, flexWrap: "wrap" },
  beatList: { display: "flex", flexDirection: "column", gap: 6, maxHeight: 190, overflowY: "auto" },
  beatRow: {
    display: "flex", alignItems: "flex-start", gap: 7,
    padding: "6px 8px", borderRadius: 8,
    background: "var(--surface2)", border: "1px solid var(--border)",
  },
  kindBadge: {
    flexShrink: 0, padding: "2px 7px", borderRadius: 999,
    background: "var(--surface)", border: "1px solid var(--border)",
    color: "var(--accent)", fontFamily: "Quicksand, sans-serif",
    fontSize: 9.5, fontWeight: 600, whiteSpace: "nowrap",
  },
  beatText: { flex: 1, minWidth: 0, color: "var(--text)", fontSize: 11, lineHeight: 1.4 },
  sayBtn: {
    flexShrink: 0, width: 24, height: 22, padding: 0,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    background: "transparent", color: "var(--accent)",
    border: "1.5px solid var(--accent)", borderRadius: 7, cursor: "pointer",
  },
  toggle: {
    width: 38, height: 22, borderRadius: 11, border: "none",
    padding: 3, cursor: "pointer", position: "relative",
    display: "inline-flex", alignItems: "center", flexShrink: 0,
  },
  toggleKnob: {
    width: 16, height: 16, borderRadius: "50%",
    display: "block", transition: "transform .15s ease",
  },
};
