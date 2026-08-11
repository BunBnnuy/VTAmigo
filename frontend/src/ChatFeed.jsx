import React, { useEffect, useRef, useState } from "react";
import {
  Star, PartyPopper, Gift, Swords, Gem, Megaphone,
  Keyboard, Mic, SlidersHorizontal, AlertTriangle, Zap,
} from "lucide-react";
import { useTranslation } from "./i18n/index.js";

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const EVENT_ICONS = {
  follow: Star,
  sub: PartyPopper,
  resub: PartyPopper,
  giftsub: Gift,
  raid: Swords,
  cheer: Gem,
};

export default function ChatFeed({
  messages, onSend,
  micSupported, micChromeAllowed, micMode, micActive, micError, micSpeaking, micLastText, onMicModeChange,
  lang,
}) {
  const bottomRef = useRef(null);
  const [draft, setDraft] = useState("");
  const { t } = useTranslation(lang);

  useEffect(() => {
    // block: "nearest" keeps this scoped to the message list's own scroll
    // container — the default "start" alignment cascades up through every
    // scrollable ancestor (including #root, which has overflow:hidden but
    // is still a valid scroll port for scrollIntoView), nudging the whole
    // app down a few pixels on every new message.
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
            const IconComp = EVENT_ICONS[m.eventKind] || Megaphone;
            return (
              <div key={m.id} style={styles.eventRow}>
                <span style={styles.time}>{formatTime(m.timestamp)}</span>
                <span style={styles.eventIcon}><IconComp size={14} /></span>
                <span style={styles.eventUser}>{m.username}</span>
                <span style={styles.eventText}>{m.text}</span>
              </div>
            );
          }

          if (m.isVoice || m.isTyped) {
            return (
              <div key={m.id} style={styles.voiceRow}>
                <span style={styles.time}>{formatTime(m.timestamp)}</span>
                <span style={styles.voiceIcon}>{m.isTyped ? <Keyboard size={14} /> : <Mic size={14} />}</span>
                <span style={{ ...styles.user, color: "#00d4ff" }}>{m.username}</span>
                <span style={styles.colon}>: </span>
                <span style={{ ...styles.text, fontStyle: "italic" }}>{m.text}</span>
              </div>
            );
          }

          if (m.isCommand) {
            return (
              <div key={m.id} style={{ ...styles.eventRow, ...(m.ok ? {} : styles.commandErrorRow) }}>
                <span style={styles.time}>{formatTime(m.timestamp)}</span>
                <span style={styles.eventIcon}>{m.ok ? <SlidersHorizontal size={14} /> : <AlertTriangle size={14} color="var(--yellow)" />}</span>
                <span style={styles.eventText}>{m.text}</span>
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
                <span style={styles.redeemBadge} title={m.rewardTitle || t("chatFeed.pointsRedeem")}><Gift size={14} /></span>
              )}
              <span style={{ ...styles.user, color: m.color }}>{m.username}</span>
              <span style={styles.colon}>: </span>
              <span style={styles.text}>{m.text || m.rewardTitle}</span>
              {m.isHype && <span style={styles.hype}><Zap size={14} /></span>}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      {micSupported && micActive && !micError && (
        // Live heard-speech feedback — display only, deliberately separate
        // from the typed-message input below regardless of mic mode. It's
        // never sent to Twitch chat; whether it also lands in the chat feed
        // history / AI buffer or triggers a command depends on mic mode
        // (see voice.onTranscript in App.jsx), but this row always shows
        // what the mic is hearing so the streamer gets instant feedback.
        <div style={styles.voiceOutRow}>
          <span style={styles.voiceOutIcon}><Mic size={14} /></span>
          <span style={styles.voiceOutText}>
            {micSpeaking ? t("chatFeed.listening") : micLastText || t("chatFeed.waitingForSpeech")}
          </span>
        </div>
      )}
      {(micSupported || onSend) && (
        <div style={styles.inputRow}>
          {micSupported && (
            <div
              style={styles.micControl}
              title={!micChromeAllowed ? t("chatFeed.micChromeOnly") : micError || undefined}
            >
              <span
                style={{
                  ...styles.micDot,
                  background: micError ? "var(--red)" : micActive ? "#00d4ff" : "var(--text-muted)",
                  animation: micSpeaking ? "pulse 0.8s infinite" : "none",
                }}
              />
              <select
                style={{
                  ...styles.micSelect,
                  opacity: micChromeAllowed ? 1 : 0.4,
                  cursor: micChromeAllowed ? "pointer" : "not-allowed",
                }}
                disabled={!micChromeAllowed}
                value={micMode}
                onChange={(e) => onMicModeChange(e.target.value)}
              >
                <option value="off">{t("chatFeed.micModeOff")}</option>
                <option value="voice">{t("chatFeed.micModeVoice")}</option>
                <option value="commands">{t("chatFeed.micModeCommands")}</option>
                <option value="full">{t("chatFeed.micModeFull")}</option>
              </select>
            </div>
          )}
          {onSend && (
            <form style={styles.inputBar} onSubmit={submit}>
              <input
                style={styles.input}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={t("chatFeed.inputPlaceholder")}
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
  voiceOutRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderTop: "1px solid var(--border)",
    background: "rgba(0, 212, 255, 0.07)",
    flexShrink: 0,
  },
  voiceOutIcon: {
    fontSize: 12,
    flexShrink: 0,
    opacity: 0.8,
  },
  voiceOutText: {
    fontSize: 12,
    fontStyle: "italic",
    color: "#00d4ff",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  inputRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 10px",
    borderTop: "1px solid var(--border)",
    flexShrink: 0,
  },
  micControl: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  micDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  micSelect: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    color: "var(--text)",
    fontSize: 12,
    padding: "5px 8px",
    width: "auto",
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
    background: "var(--accent)",
    color: "var(--on-accent)",
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
  commandErrorRow: {
    background: "rgba(255, 0, 0, 0.08)",
    borderLeft: "2px solid var(--red)",
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
    background: "rgba(225, 29, 118, 0.08)",
    borderLeft: "2px solid var(--accent)",
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
    color: "var(--accent-light)",
    background: "rgba(225, 29, 118, 0.15)",
    borderRadius: 4,
    padding: "1px 5px",
    flexShrink: 0,
    fontWeight: 600,
  },
};
