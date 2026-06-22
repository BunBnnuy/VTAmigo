import React, { useEffect, useRef } from "react";

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const EVENT_ICONS = {
  follow: "⭐",
  sub: "🎉",
  resub: "🎉",
  giftsub: "🎁",
  raid: "⚔️",
  cheer: "💎",
};

export default function ChatFeed({ messages }) {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div style={styles.feed}>
      {messages.length === 0 && (
        <div style={styles.empty}>Sin mensajes aún — conéctate a un canal para empezar.</div>
      )}
      {messages.map((m) => {
        if (m.isEvent) {
          const icon = EVENT_ICONS[m.eventKind] || "📢";
          return (
            <div key={m.id} style={styles.eventRow}>
              <span style={styles.time}>{formatTime(m.timestamp)}</span>
              <span style={styles.eventIcon}>{icon}</span>
              <span style={styles.eventUser}>{m.username}</span>
              <span style={styles.eventText}>{m.text}</span>
            </div>
          );
        }

        if (m.isVoice) {
          return (
            <div key={m.id} style={styles.voiceRow}>
              <span style={styles.time}>{formatTime(m.timestamp)}</span>
              <span style={styles.voiceIcon}>🎙</span>
              <span style={{ ...styles.user, color: "#00d4ff" }}>{m.username}</span>
              <span style={styles.colon}>: </span>
              <span style={{ ...styles.text, fontStyle: "italic" }}>{m.text}</span>
            </div>
          );
        }

        return (
          <div key={m.id} style={{ ...styles.row, ...(m.isRedeem ? styles.redeemRow : {}) }}>
            <span style={styles.time}>{formatTime(m.timestamp)}</span>
            {m.isRedeem && (
              <span style={styles.redeemBadge} title={m.rewardTitle || "Canje de puntos"}>🎁</span>
            )}
            <span style={{ ...styles.user, color: m.color }}>{m.username}</span>
            <span style={styles.colon}>: </span>
            <span style={styles.text}>{m.text || m.rewardTitle}</span>
            {m.isHype && <span style={styles.hype}>⚡</span>}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}

const styles = {
  feed: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  empty: {
    color: "var(--text-muted)",
    textAlign: "center",
    marginTop: 40,
    fontSize: 13,
  },
  row: {
    display: "flex",
    alignItems: "baseline",
    gap: 4,
    lineHeight: 1.5,
    flexWrap: "wrap",
  },
  eventRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "5px 8px",
    margin: "3px 0",
    background: "rgba(255, 179, 26, 0.08)",
    borderLeft: "2px solid var(--yellow)",
    borderRadius: 4,
    flexWrap: "wrap",
  },
  eventIcon: {
    fontSize: 14,
    flexShrink: 0,
  },
  eventUser: {
    fontWeight: 700,
    fontSize: 13,
    color: "var(--yellow)",
  },
  eventText: {
    fontSize: 13,
    color: "var(--text)",
  },
  time: {
    color: "var(--text-muted)",
    fontSize: 11,
    flexShrink: 0,
  },
  user: {
    fontWeight: 700,
    fontSize: 13,
  },
  colon: {
    color: "var(--text-muted)",
  },
  text: {
    color: "var(--text)",
    fontSize: 13,
    wordBreak: "break-word",
  },
  hype: {
    fontSize: 11,
    marginLeft: 2,
  },
  redeemRow: {
    background: "rgba(145, 71, 255, 0.08)",
    borderLeft: "2px solid var(--purple)",
    paddingLeft: 6,
    borderRadius: 4,
  },
  redeemBadge: {
    fontSize: 12,
    flexShrink: 0,
  },
  voiceRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 4,
    lineHeight: 1.5,
    flexWrap: "wrap",
    background: "rgba(0, 212, 255, 0.07)",
    borderLeft: "2px solid #00d4ff",
    paddingLeft: 6,
    borderRadius: 4,
  },
  voiceIcon: {
    fontSize: 11,
    flexShrink: 0,
    opacity: 0.7,
  },
};
