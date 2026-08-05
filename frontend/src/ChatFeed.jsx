import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "./i18n/index.js";

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

export default function ChatFeed({
  messages, onSend,
  micSupported, micChromeAllowed, micActive, micError, micModelStatus, micSpeaking, micLastText, onToggleMic,
  lang,
}) {
  const bottomRef = useRef(null);
  const [draft, setDraft] = useState("");
  const { t } = useTranslation(lang);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submit = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !onSend) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.feed}>
        {messages.length === 0 && (
          <div style={styles.empty}>{t("chatFeed.empty")}</div>
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

          if (m.isVoice || m.isTyped) {
            return (
              <div key={m.id} style={styles.voiceRow}>
                <span style={styles.time}>{formatTime(m.timestamp)}</span>
                <span style={styles.voiceIcon}>{m.isTyped ? "⌨️" : "🎙"}</span>
                <span style={{ ...styles.user, color: "#00d4ff" }}>{m.username}</span>
                <span style={styles.colon}>: </span>
                <span style={{ ...styles.text, fontStyle: "italic" }}>{m.text}</span>
              </div>
            );
          }

          return (
            <div key={m.id} style={{ ...styles.row, ...(m.isRedeem ? styles.redeemRow : {}) }}>
              <span style={styles.time}>{formatTime(m.timestamp)}</span>
              {m.extraChannel && (
                <span style={styles.channelBadge}>#{m.extraChannel}</span>
              )}
              {m.isRedeem && (
                <span style={styles.redeemBadge} title={m.rewardTitle || t("chatFeed.pointsRedeem")}>🎁</span>
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
      {(micSupported || onSend) && (
        <div style={styles.inputRow}>
          {micSupported && (
            <button
              type="button"
              disabled={!micChromeAllowed}
              style={{
                ...styles.micBtn,
                color: micError ? "var(--red)" : micActive ? "#00d4ff" : "var(--text-muted)",
                borderColor: micError ? "var(--red)" : micActive ? "#00d4ff" : "var(--border)",
                animation: micSpeaking ? "pulse 0.8s infinite" : "none",
                opacity: micChromeAllowed ? 1 : 0.4,
                cursor: micChromeAllowed ? "pointer" : "not-allowed",
              }}
              onClick={onToggleMic}
              title={
                !micChromeAllowed
                  ? t("chatFeed.micChromeOnly")
                  : micError || (micActive ? t("chatFeed.micActiveTitle") : t("chatFeed.micEnableTitle"))
              }
            >
              {micError ? t("chatFeed.micError") : micModelStatus === "loading" ? t("chatFeed.micLoading") : micActive ? t("chatFeed.micLive") : t("chatFeed.micIdle")}
            </button>
          )}
          {onSend && (
            <form style={styles.inputBar} onSubmit={submit}>
              <input
                style={styles.input}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={
                  micActive && !micError
                    ? (micSpeaking ? t("chatFeed.listening") : micLastText || t("chatFeed.waitingForSpeech"))
                    : t("chatFeed.inputPlaceholder")
                }
              />
              <button style={styles.sendBtn} type="submit" disabled={!draft.trim()}>
                {t("chatFeed.send")}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  feed: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 10px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 10px",
    borderTop: "1px solid var(--border)",
    flexShrink: 0,
  },
  micBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontSize: 12,
    padding: "5px 10px",
    cursor: "pointer",
    flexShrink: 0,
  },
  inputBar: {
    display: "flex",
    gap: 6,
    flex: 1,
  },
  input: {
    flex: 1,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    padding: "6px 8px",
    color: "var(--text)",
    fontSize: 13,
  },
  sendBtn: {
    background: "var(--purple)",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
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
  channelBadge: {
    fontSize: 10,
    color: "var(--purple-light)",
    background: "rgba(145, 71, 255, 0.15)",
    borderRadius: 4,
    padding: "1px 5px",
    flexShrink: 0,
    fontWeight: 600,
  },
};
