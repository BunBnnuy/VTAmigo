import React, { useState, useEffect } from "react";
import { apiFetch } from "./api.js";
import { tts } from "./TTSController.js";
import { buildVoiceOptions, parseVoiceValue, selectedVoiceValue, voiceSelectionPatch, withSelectedOption } from "./ttsVoices.js";
import { useTranslation } from "./i18n/index.js";
import { RefreshCw, AlertTriangle, SkipForward, Play } from "lucide-react";

function Toggle({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        ...styles.toggle,
        background: checked ? "var(--accent)" : "var(--border)",
      }}
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

// Content only — outer window chrome (drag/resize/collapse) is provided by
// WindowManager.jsx's shared <Window>.
export default function QuickControls({
  autoSendToChat, onToggleAutoSend,
  muted, onToggleMute,
  ttsPlaying, onSkipTts,
  nowDisabled, nowOnCooldown, nowRemainingSec, nowTitle, onNowClick,
  settings, onUpdateSetting, onUpdateSettings, lang,
  queuedCount, onPruneQueue,
}) {
  const { t } = useTranslation(lang);

  // ── TTS provider / voice ─────────────────────────────────────────────────
  const [voices, setVoices] = useState([]);
  const [piperVoices, setPiperVoices] = useState([]);
  const [piperStatus, setPiperStatus] = useState("");
  const [kittenVoices, setKittenVoices] = useState([]);
  const [kittenStatus, setKittenStatus] = useState("");
  const [kokoroVoices, setKokoroVoices] = useState([]);
  const [kokoroStatus, setKokoroStatus] = useState("");

  useEffect(() => {
    const load = () => setVoices(tts.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);

  const loadPiperVoices = async () => {
    setPiperStatus("loading");
    try {
      const res = await apiFetch("/tts/piper/voices");
      const data = await res.json();
      setPiperVoices(data.voices || []);
      setPiperStatus(data.installed ? "ok" : "missing");
    } catch (err) {
      setPiperVoices([]);
      setPiperStatus(err.message);
    }
  };

  const loadKittenVoices = async () => {
    setKittenStatus("loading");
    try {
      const res = await apiFetch("/tts/kitten/voices");
      const data = await res.json();
      setKittenVoices(data.voices || []);
      setKittenStatus(data.installed ? "ok" : "missing");
    } catch (err) {
      setKittenVoices([]);
      setKittenStatus(err.message);
    }
  };

  const loadKokoroVoices = async () => {
    setKokoroStatus("loading");
    try {
      const res = await apiFetch("/tts/kokoro/voices");
      const data = await res.json();
      setKokoroVoices(data.voices || []);
      setKokoroStatus(data.installed ? "ok" : "missing");
    } catch (err) {
      setKokoroVoices([]);
      setKokoroStatus(err.message);
    }
  };

  useEffect(() => {
    if (!settings) return;
    // The unified voice list shows every engine at once, so all three local
    // lists load on mount (and the refresh button reloads them together).
    loadPiperVoices();
    loadKittenVoices();
    loadKokoroVoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const voiceValue = settings ? selectedVoiceValue(settings) : "windows:";
  const voiceOptions = withSelectedOption(
    buildVoiceOptions({ voices, piperVoices, kittenVoices, kokoroVoices, t }),
    voiceValue,
    t
  );
  const selectedProvider = parseVoiceValue(voiceValue).provider;
  const providerStatus = { piper: piperStatus, kitten: kittenStatus, kokoro: kokoroStatus }[selectedProvider];
  const providerMissing = {
    piper: t("quickControls.piperMissing"),
    kitten: t("quickControls.kittenMissing"),
    kokoro: t("quickControls.kokoroMissing"),
  }[selectedProvider];
  const loadingVoices = [piperStatus, kittenStatus, kokoroStatus].includes("loading");
  const loadAllVoices = () => {
    loadPiperVoices();
    loadKittenVoices();
    loadKokoroVoices();
  };
  const pickVoice = (value) => {
    const patch = voiceSelectionPatch(value);
    if (onUpdateSettings) onUpdateSettings(patch);
    else {
      onUpdateSetting("ttsProvider", patch.ttsProvider);
      Object.entries(patch).forEach(([key, setting]) => {
        if (key !== "ttsProvider") onUpdateSetting(key, setting);
      });
    }
  };

  return (
    <>
      <div style={styles.body}>
        {settings && onUpdateSetting && (
          <div style={styles.row}>
            <span style={styles.rowLabel}>{t("quickControls.aiResponses")}</span>
            <Toggle
              checked={settings.aiResponsesEnabled !== false}
              onChange={() => onUpdateSetting("aiResponsesEnabled", !(settings.aiResponsesEnabled !== false))}
            />
          </div>
        )}
        {typeof queuedCount === "number" && (
          <div style={styles.row}>
            <span style={styles.rowLabel}>{t("quickControls.queued", { count: queuedCount })}</span>
            {onPruneQueue && queuedCount > 0 && (
              <button style={styles.smallBtn} onClick={onPruneQueue} title={t("quickControls.pruneTitle")}>
                {t("quickControls.prune")}
              </button>
            )}
          </div>
        )}
        {onToggleAutoSend && (
          <div style={styles.row}>
            <span style={styles.rowLabel}>{t("quickControls.autoSend")}</span>
            <Toggle checked={autoSendToChat} onChange={onToggleAutoSend} />
          </div>
        )}
        {onToggleMute && (
          <div style={styles.row}>
            <span style={styles.rowLabel}>{t("quickControls.tts")}</span>
            <Toggle checked={!muted} onChange={onToggleMute} />
          </div>
        )}
        {ttsPlaying && onSkipTts && (
          <button style={styles.actionBtn} onClick={onSkipTts} title={t("quickControls.skipTtsTitle")}>
            <SkipForward size={14} color="var(--accent)" /> {t("quickControls.skipTts")}
          </button>
        )}
        {onNowClick && (
          <button
            style={{ ...styles.actionBtn, opacity: nowDisabled ? 0.5 : 1 }}
            onClick={onNowClick}
            disabled={nowDisabled}
            title={nowTitle}
          >
            <Play size={14} color="var(--accent)" /> {t("quickControls.now", {
              cooldownSuffix: nowOnCooldown
                ? t("quickControls.nowCooldownSuffix", { time: `${Math.floor(nowRemainingSec / 60)}:${String(nowRemainingSec % 60).padStart(2, "0")}` })
                : "",
            })}
          </button>
        )}

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("quickControls.voiceSection")}</div>

        {settings && (onUpdateSetting || onUpdateSettings) && (
          <div style={styles.field}>
            <label style={styles.fieldLabel}>{t("quickControls.voice")}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <select
                value={voiceValue}
                onChange={(e) => pickVoice(e.target.value)}
                style={{ flex: 1 }}
              >
                {voiceOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button
                type="button"
                style={styles.smallBtn}
                onClick={loadAllVoices}
                disabled={loadingVoices}
              >
                <RefreshCw size={14} color="var(--accent)" />
              </button>
            </div>
            {providerStatus === "missing" && providerMissing && (
              <span style={styles.errorText}>{providerMissing}</span>
            )}
            {providerStatus && !["loading", "ok", "missing"].includes(providerStatus) && (
              <span style={styles.errorText}><AlertTriangle size={14} color="var(--yellow)" /> {providerStatus}</span>
            )}
            <span style={styles.hint}>{t("quickControls.voiceHint")}</span>
          </div>
        )}
      </div>
      <div style={styles.hint}>{t("quickControls.hint")}</div>
    </>
  );
}

const styles = {
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
    width: 38,
    height: 22,
    borderRadius: 11,
    padding: 3,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    flexShrink: 0,
  },
  toggleKnob: {
    width: 16,
    height: 16,
    flexShrink: 0,
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
  divider: {
    height: 1,
    background: "var(--border)",
    margin: "2px 0",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  errorText: {
    fontSize: 10,
    color: "var(--red)",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  smallBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "0 8px",
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
  },
};
