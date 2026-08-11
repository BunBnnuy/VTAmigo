import React, { useState, useEffect } from "react";
import { apiFetch } from "./api.js";
import { tts } from "./TTSController.js";
import { useTranslation } from "./i18n/index.js";

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
  settings, onUpdateSetting, lang,
  queuedCount, onPruneQueue,
}) {
  const { t } = useTranslation(lang);

  // ── TTS provider / voice ─────────────────────────────────────────────────
  const [voices, setVoices] = useState([]);
  const [elevenVoices, setElevenVoices] = useState([]);
  const [elevenVoicesStatus, setElevenVoicesStatus] = useState("");
  const [piperVoices, setPiperVoices] = useState([]);
  const [piperStatus, setPiperStatus] = useState("");

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

  const loadElevenVoices = async (apiKey) => {
    if (!apiKey) return;
    setElevenVoicesStatus("loading");
    try {
      const res = await apiFetch("/tts/elevenlabs/voices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setElevenVoices(data.voices || []);
      setElevenVoicesStatus("");
    } catch (err) {
      setElevenVoices([]);
      setElevenVoicesStatus(err.message);
    }
  };

  useEffect(() => {
    if (!settings) return;
    if (settings.ttsProvider === "elevenlabs" && settings.elevenLabsKey) loadElevenVoices(settings.elevenLabsKey);
    if (settings.ttsProvider === "piper") loadPiperVoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ttsProvider = settings?.ttsProvider || "windows";

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
            {t("quickControls.skipTts")}
          </button>
        )}
        {onNowClick && (
          <button
            style={{ ...styles.actionBtn, opacity: nowDisabled ? 0.5 : 1 }}
            onClick={onNowClick}
            disabled={nowDisabled}
            title={nowTitle}
          >
            {t("quickControls.now", {
              cooldownSuffix: nowOnCooldown
                ? t("quickControls.nowCooldownSuffix", { time: `${Math.floor(nowRemainingSec / 60)}:${String(nowRemainingSec % 60).padStart(2, "0")}` })
                : "",
            })}
          </button>
        )}

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("quickControls.voiceSection")}</div>

        {settings && onUpdateSetting && (
          <>
            <div style={styles.field}>
              <label style={styles.fieldLabel}>{t("quickControls.provider")}</label>
              <select
                value={ttsProvider}
                onChange={(e) => {
                  onUpdateSetting("ttsProvider", e.target.value);
                  if (e.target.value === "piper") loadPiperVoices();
                }}
              >
                <option value="windows">{t("quickControls.windowsOption")}</option>
                <option value="elevenlabs" disabled={ttsProvider !== "elevenlabs"}>
                  {t("quickControls.elevenlabsOption")}{ttsProvider !== "elevenlabs" ? t("quickControls.elevenlabsUnavailable") : ""}
                </option>
                <option value="piper">Piper</option>
              </select>
            </div>

            {ttsProvider === "windows" && (
              <div style={styles.field}>
                <label style={styles.fieldLabel}>{t("quickControls.voice")}</label>
                <select
                  value={settings.voiceURI || ""}
                  onChange={(e) => onUpdateSetting("voiceURI", e.target.value)}
                >
                  <option value="">{t("quickControls.systemDefault")}</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {ttsProvider === "elevenlabs" && (
              <div style={styles.field}>
                <label style={styles.fieldLabel}>{t("quickControls.voice")}</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <select
                    value={settings.elevenLabsVoiceId || ""}
                    onChange={(e) => onUpdateSetting("elevenLabsVoiceId", e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">{t("quickControls.chooseVoice")}</option>
                    {elevenVoices.map((v) => (
                      <option key={v.voice_id} value={v.voice_id}>
                        {v.name}{v.category ? ` (${v.category})` : ""}
                      </option>
                    ))}
                    {settings.elevenLabsVoiceId && !elevenVoices.some((v) => v.voice_id === settings.elevenLabsVoiceId) && (
                      <option value={settings.elevenLabsVoiceId}>{settings.elevenLabsVoiceId}{t("quickControls.saved")}</option>
                    )}
                  </select>
                  <button
                    type="button"
                    style={styles.smallBtn}
                    onClick={() => loadElevenVoices(settings.elevenLabsKey)}
                    disabled={!settings.elevenLabsKey || elevenVoicesStatus === "loading"}
                  >
                    ↻
                  </button>
                </div>
                {elevenVoicesStatus && elevenVoicesStatus !== "loading" && (
                  <span style={styles.errorText}>⚠ {elevenVoicesStatus}</span>
                )}
              </div>
            )}

            {ttsProvider === "piper" && (
              <div style={styles.field}>
                <label style={styles.fieldLabel}>{t("quickControls.voice")}</label>
                <div style={{ display: "flex", gap: 6 }}>
                  <select
                    value={settings.piperVoice || ""}
                    onChange={(e) => onUpdateSetting("piperVoice", e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">{t("quickControls.defaultOption")}</option>
                    {piperVoices.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    style={styles.smallBtn}
                    onClick={loadPiperVoices}
                    disabled={piperStatus === "loading"}
                  >
                    ↻
                  </button>
                </div>
                {piperStatus === "missing" && (
                  <span style={styles.errorText}>{t("quickControls.piperMissing")}</span>
                )}
                {piperStatus && !["loading", "ok", "missing"].includes(piperStatus) && (
                  <span style={styles.errorText}>⚠ {piperStatus}</span>
                )}
              </div>
            )}
          </>
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
