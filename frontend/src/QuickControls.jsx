import React from "react";

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

export default function QuickControls({
  collapsed, onToggleCollapse,
  autoSendToChat, onToggleAutoSend,
  muted, onToggleMute,
  ttsPlaying, onSkipTts,
  nowDisabled, nowOnCooldown, nowRemainingSec, nowTitle, onNowClick,
}) {
  if (collapsed) {
    return (
      <div style={styles.collapsedPanel}>
        <button style={styles.collapseBtn} onClick={onToggleCollapse} title="Expand quick controls">
          ⟨
        </button>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>Controles Rápidos</span>
        <button style={styles.collapseBtn} onClick={onToggleCollapse} title="Collapse quick controls">
          ⟩
        </button>
      </div>
      <div style={styles.body}>
        {onToggleAutoSend && (
          <div style={styles.row}>
            <span style={styles.rowLabel}>Auto-send</span>
            <Toggle checked={autoSendToChat} onChange={onToggleAutoSend} />
          </div>
        )}
        {onToggleMute && (
          <div style={styles.row}>
            <span style={styles.rowLabel}>Text-to-Speech (TTS)</span>
            <Toggle checked={!muted} onChange={onToggleMute} />
          </div>
        )}
        {ttsPlaying && onSkipTts && (
          <button style={styles.actionBtn} onClick={onSkipTts} title="Skip current TTS">
            ⏭ Skip TTS
          </button>
        )}
        {onNowClick && (
          <button
            style={{ ...styles.actionBtn, opacity: nowDisabled ? 0.5 : 1 }}
            onClick={onNowClick}
            disabled={nowDisabled}
            title={nowTitle}
          >
            ▶ Now{nowOnCooldown ? ` (${Math.floor(nowRemainingSec / 60)}:${String(nowRemainingSec % 60).padStart(2, "0")})` : ""}
          </button>
        )}
      </div>
      <div style={styles.hint}>Este panel se puede ocultar en modo compacto</div>
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
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowLabel: {
    fontSize: 13,
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
  actionBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 10px",
    textAlign: "left",
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
  },
};
