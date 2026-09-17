import React, { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { chatTts } from "./ChatTTSController.js";
import { useTranslation } from "./i18n/index.js";

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{ ...styles.toggle, background: checked ? "var(--accent)" : "var(--border)" }}
    >
      <span style={{
        ...styles.toggleKnob,
        background: checked ? "var(--on-accent)" : "#fff",
        transform: checked ? "translateX(16px)" : "translateX(0)",
      }} />
    </button>
  );
}

// Content only — the outer draggable/resizable frame is provided by Window.
export default function ChatTTSPPanel({ enabled, command, voiceURI, onUpdateSetting, lang }) {
  const { t } = useTranslation(lang);
  const [voices, setVoices] = useState([]);

  useEffect(() => {
    const loadVoices = () => setVoices(chatTts.getVoices());
    loadVoices();
    window.speechSynthesis?.addEventListener?.("voiceschanged", loadVoices);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", loadVoices);
  }, []);

  return (
    <div style={styles.body}>
      <div style={styles.row}>
        <span style={styles.rowLabel}>{t("chatTtsPanel.enabled")}</span>
        <Toggle checked={enabled} onChange={() => onUpdateSetting("chatTtsEnabled", !enabled)} />
      </div>

      <div style={styles.field}>
        <label style={styles.fieldLabel} htmlFor="chat-tts-command">{t("chatTtsPanel.command")}</label>
        <input
          id="chat-tts-command"
          type="text"
          value={command || ""}
          placeholder={t("chatTtsPanel.commandPlaceholder")}
          onChange={(e) => onUpdateSetting("chatTtsCommand", e.target.value.replace(/^!+/, ""))}
          spellCheck="false"
        />
        <span style={styles.hint}>{t("chatTtsPanel.commandHint", { command: command || "tts" })}</span>
      </div>

      <div style={styles.field}>
        <label style={styles.fieldLabel} htmlFor="chat-tts-voice">{t("chatTtsPanel.voice")}</label>
        <select
          id="chat-tts-voice"
          value={voiceURI || ""}
          onChange={(e) => onUpdateSetting("chatTtsVoiceURI", e.target.value)}
        >
          <option value="">{t("chatTtsPanel.systemDefault")}</option>
          {voices.map((voice) => (
            <option key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>
      </div>

      <div style={styles.note}>
        {enabled ? <Volume2 size={14} color="var(--accent)" /> : <VolumeX size={14} color="var(--text-muted)" />}
        <span>{t("chatTtsPanel.hint")}</span>
      </div>
    </div>
  );
}

const styles = {
  body: { display: "flex", flexDirection: "column", gap: 16, padding: "14px 12px", overflowY: "auto" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowLabel: { fontSize: 13, color: "var(--text)" },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.03em" },
  hint: { fontSize: 11, lineHeight: 1.4, color: "var(--text-muted)" },
  note: { display: "flex", alignItems: "flex-start", gap: 7, fontSize: 11, lineHeight: 1.4, color: "var(--text-muted)" },
  toggle: { width: 38, height: 22, borderRadius: 11, padding: 3, display: "flex", alignItems: "center", justifyContent: "flex-start", flexShrink: 0 },
  toggleKnob: { width: 16, height: 16, flexShrink: 0, borderRadius: "50%", transition: "transform 0.15s" },
};
