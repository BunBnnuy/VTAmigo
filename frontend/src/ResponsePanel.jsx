import React, { useEffect, useRef } from "react";

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function ResponsePanel({
  responses, loading, onSendToChat, botConnected,
  autoSendToChat, onToggleAutoSend,
  muted, onToggleMute, ttsPlaying, onSkipTts,
  nowDisabled, nowOnCooldown, nowRemainingSec, nowTitle, onNowClick,
}) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [responses]);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>AI Responses</span>
        {loading && <span style={styles.thinking}>thinking…</span>}
        <div style={styles.headerControls}>
          {onToggleAutoSend && (
            <button
              style={{ ...styles.controlBtn, color: autoSendToChat ? "var(--green)" : "var(--text-muted)" }}
              onClick={onToggleAutoSend}
              title="Auto-send AI responses to chat"
            >
              {autoSendToChat ? "💬 Auto-send ON" : "💬 Auto-send OFF"}
            </button>
          )}
          {ttsPlaying && onSkipTts && (
            <button style={{ ...styles.controlBtn, color: "var(--purple-light)" }} onClick={onSkipTts} title="Skip current TTS">
              ⏭ Skip
            </button>
          )}
          {onToggleMute && (
            <button
              style={{ ...styles.controlBtn, color: muted ? "var(--red)" : "var(--text)" }}
              onClick={onToggleMute}
              title={muted ? "Unmute TTS" : "Mute TTS"}
            >
              {muted ? "🔇 Muted" : "🔊 TTS"}
            </button>
          )}
          {onNowClick && (
            <button
              style={{ ...styles.controlBtn, color: "var(--text-muted)", opacity: nowDisabled && !loading ? 0.5 : 1 }}
              onClick={onNowClick}
              disabled={nowDisabled}
              title={nowTitle}
            >
              ▶ Now{nowOnCooldown ? ` (${Math.floor(nowRemainingSec / 60)}:${String(nowRemainingSec % 60).padStart(2, "0")})` : ""}
            </button>
          )}
        </div>
      </div>
      <div style={styles.list}>
        {responses.length === 0 && (
          <div style={styles.empty}>Responses will appear here once chat triggers one.</div>
        )}
        {responses.map((r) => (
          <div key={r.id} style={{ ...styles.card, borderColor: r.error ? "var(--red)" : "var(--purple)" }}>
            <div style={styles.cardTime}>
              {formatTime(r.timestamp)}
              {r.eventLabel && <span style={styles.eventLabel}> · {r.eventLabel}</span>}
            </div>
            <div style={r.error ? styles.errorText : styles.responseText}>{r.text}</div>
            <div style={styles.cardFooter}>
              {r.messageCount && (
                <span style={styles.meta}>{r.messageCount} mensajes</span>
              )}
              {!r.error && onSendToChat && (
                <button
                  style={{ ...styles.sendBtn, opacity: botConnected ? 1 : 0.4 }}
                  title={botConnected ? "Send to Twitch chat" : "Bot not connected"}
                  onClick={() => botConnected && onSendToChat(r.text)}
                >
                  💬 Send
                </button>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ ...styles.card, borderColor: "var(--border)" }}>
            <div style={styles.skeleton} />
            <div style={{ ...styles.skeleton, width: "60%", marginTop: 6 }} />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const styles = {
  panel: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border)",
    flexWrap: "wrap",
  },
  headerControls: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginLeft: "auto",
  },
  controlBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontSize: 11,
    padding: "4px 8px",
    cursor: "pointer",
  },
  title: {
    fontWeight: 700,
    fontSize: 13,
    color: "var(--purple-light)",
  },
  thinking: {
    fontSize: 12,
    color: "var(--text-muted)",
    fontStyle: "italic",
    animation: "pulse 1.2s ease-in-out infinite",
  },
  list: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  empty: {
    color: "var(--text-muted)",
    textAlign: "center",
    marginTop: 40,
    fontSize: 13,
  },
  card: {
    background: "var(--surface2)",
    border: "1px solid",
    borderRadius: 8,
    padding: "10px 12px",
  },
  cardTime: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginBottom: 6,
  },
  responseText: {
    color: "var(--text)",
    lineHeight: 1.6,
    fontSize: 14,
  },
  errorText: {
    color: "var(--red)",
    lineHeight: 1.6,
    fontSize: 13,
  },
  cardFooter: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  meta: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  sendBtn: {
    background: "var(--purple)",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "2px 8px",
    fontSize: 11,
    cursor: "pointer",
  },
  eventLabel: {
    color: "var(--yellow)",
    fontWeight: 600,
  },
  skeleton: {
    height: 14,
    background: "var(--border)",
    borderRadius: 4,
    width: "85%",
    animation: "pulse 1.2s ease-in-out infinite",
  },
};
