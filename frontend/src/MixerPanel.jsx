import React from "react";
import { Volume2 } from "lucide-react";
import { useTranslation } from "./i18n/index.js";
import { MIXER_CHANNELS } from "./mixer.js";

// Content only — the outer draggable/resizable frame is provided by Window.
// One slider per sound source. The app applies channels it plays itself
// (bot/chat TTS) and posts the values to /mixer, which broadcasts them to every
// OBS overlay so alerts, the video queue, shoutouts, custom sound layers and
// the bot-voice overlay all follow the same mix.
export default function MixerPanel({ mixer, onChange, lang }) {
  const { t } = useTranslation(lang);
  const channels = MIXER_CHANNELS.filter((key) => key !== "master");

  const slider = (channel) => {
    const value = mixer?.[channel] ?? 1;
    return (
      <div key={channel} style={styles.channel}>
        <div style={styles.channelHead}>
          <span style={styles.channelLabel}>{t(`mixerPanel.${channel}`)}</span>
          <span style={styles.channelValue}>{Math.round(value * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value}
          onChange={(e) => onChange(channel, Number(e.target.value))}
          style={{ ...styles.slider, "--pct": `${value * 100}%` }}
          aria-label={t(`mixerPanel.${channel}`)}
        />
      </div>
    );
  };

  return (
    <div style={styles.body}>
      <div style={styles.masterBox}>
        <div style={styles.channelHead}>
          <span style={{ ...styles.channelLabel, color: "var(--accent-light)" }}>
            <Volume2 size={13} /> {t("mixerPanel.master")}
          </span>
          <span style={styles.channelValue}>{Math.round((mixer?.master ?? 1) * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={mixer?.master ?? 1}
          onChange={(e) => onChange("master", Number(e.target.value))}
          style={{ ...styles.slider, "--pct": `${(mixer?.master ?? 1) * 100}%` }}
          aria-label={t("mixerPanel.master")}
        />
      </div>

      {channels.map(slider)}

      <div style={styles.hint}>{t("mixerPanel.hint")}</div>
    </div>
  );
}

const styles = {
  body: { display: "flex", flexDirection: "column", gap: 12, padding: "14px 12px", overflowY: "auto" },
  masterBox: { display: "flex", flexDirection: "column", gap: 6, paddingBottom: 12, borderBottom: "1px solid var(--border)" },
  channel: { display: "flex", flexDirection: "column", gap: 5 },
  channelHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  channelLabel: { fontSize: 12, color: "var(--text)", display: "inline-flex", alignItems: "center", gap: 5 },
  channelValue: { fontSize: 11, color: "var(--text-muted)" },
  slider: { width: "100%" },
  hint: { borderTop: "1px solid var(--border)", paddingTop: 10, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 },
};
