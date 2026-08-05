import React, { useState, useEffect } from "react";
import { apiFetch, apiUrl } from "./api.js";
import { tts } from "./TTSController.js";
import { useTranslation } from "./i18n/index.js";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

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
  ttsPlaying, ttsSpeaking, onSkipTts,
  nowDisabled, nowOnCooldown, nowRemainingSec, nowTitle, onNowClick,
  settings, onUpdateSetting, lang,
}) {
  const { t } = useTranslation(lang);
  // ── Avatar overlay: URL, uploads, live preview ──────────────────────────
  const [avatarOverlayUrl, setAvatarOverlayUrl] = useState("");
  const [avatarOverlayToken, setAvatarOverlayToken] = useState("");
  const [avatarOverlayCopied, setAvatarOverlayCopied] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState({ hasSpeaking: false, hasSilent: false });
  const [avatarPreviews, setAvatarPreviews] = useState({ speaking: null, silent: null });
  const [avatarUploading, setAvatarUploading] = useState({ speaking: false, silent: false });
  const [avatarError, setAvatarError] = useState({ speaking: "", silent: "" });

  useEffect(() => {
    apiFetch("/overlay/avatar/overlay-url")
      .then((res) => res.json())
      .then((data) => {
        setAvatarOverlayUrl(data.url || "");
        setAvatarOverlayToken(data.token || "");
        setAvatarStatus({ hasSpeaking: !!data.hasSpeaking, hasSilent: !!data.hasSilent });
      })
      .catch(() => {});
  }, []);

  const copyAvatarOverlayUrl = async () => {
    try {
      await navigator.clipboard.writeText(avatarOverlayUrl);
      setAvatarOverlayCopied(true);
      setTimeout(() => setAvatarOverlayCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can still copy from Settings instead.
    }
  };

  const avatarImageSrc = (slot) => {
    if (avatarPreviews[slot]) return avatarPreviews[slot];
    const has = slot === "speaking" ? avatarStatus.hasSpeaking : avatarStatus.hasSilent;
    if (!has || !avatarOverlayToken) return null;
    return apiUrl(`/overlay/avatar/image?slot=${slot}&token=${avatarOverlayToken}`);
  };

  const uploadAvatarImage = (slot, file) => {
    if (!file) return;
    setAvatarError((prev) => ({ ...prev, [slot]: "" }));
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setAvatarError((prev) => ({ ...prev, [slot]: t("quickControls.badFormat") }));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError((prev) => ({ ...prev, [slot]: t("quickControls.tooLarge") }));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setAvatarPreviews((prev) => ({ ...prev, [slot]: dataUrl }));
      setAvatarUploading((prev) => ({ ...prev, [slot]: true }));
      try {
        const res = await apiFetch("/overlay/avatar/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot, dataUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setAvatarStatus({ hasSpeaking: !!data.hasSpeaking, hasSilent: !!data.hasSilent });
      } catch (err) {
        setAvatarError((prev) => ({ ...prev, [slot]: t("quickControls.uploadError", { error: err.message }) }));
      } finally {
        setAvatarUploading((prev) => ({ ...prev, [slot]: false }));
      }
    };
    reader.onerror = () => setAvatarError((prev) => ({ ...prev, [slot]: t("quickControls.readError", { file: file.name }) }));
    reader.readAsDataURL(file);
  };

  const previewSlot = ttsSpeaking ? "speaking" : "silent";
  const previewSrc = avatarImageSrc(previewSlot);

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

  if (collapsed) {
    return (
      <div style={styles.collapsedPanel}>
        <button style={styles.collapseBtn} onClick={onToggleCollapse} title={t("quickControls.expand")}>
          ⟨
        </button>
        <span style={styles.verticalTitle}>{t("quickControls.title")}</span>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>{t("quickControls.title")}</span>
        <button style={styles.collapseBtn} onClick={onToggleCollapse} title={t("quickControls.collapse")}>
          ⟩
        </button>
      </div>
      <div style={styles.body}>
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

        <div style={styles.sectionLabel}>{t("quickControls.avatarSection")}</div>

        <div style={styles.avatarPreviewWrap}>
          <div
            style={{
              ...styles.avatarPreview,
              backgroundImage: previewSrc ? `url("${previewSrc.replace(/"/g, "%22")}")` : "none",
            }}
          >
            {!previewSrc && <span style={styles.avatarPreviewEmpty}>—</span>}
          </div>
          <span style={styles.avatarPreviewLabel}>
            {ttsSpeaking ? t("quickControls.speaking") : t("quickControls.silent")}
          </span>
        </div>

        <button
          style={styles.actionBtn}
          onClick={copyAvatarOverlayUrl}
          disabled={!avatarOverlayUrl}
          title={t("quickControls.copyOverlayTitle")}
        >
          {avatarOverlayCopied ? t("quickControls.copied") : t("quickControls.copyOverlay")}
        </button>

        <div style={styles.avatarUploadRow}>
          {["speaking", "silent"].map((slot) => (
            <div key={slot} style={styles.avatarUploadCol}>
              <label
                style={{
                  ...styles.uploadLabel,
                  cursor: avatarUploading[slot] ? "default" : "pointer",
                  opacity: avatarUploading[slot] ? 0.6 : 1,
                }}
              >
                {avatarUploading[slot]
                  ? t("quickControls.uploading")
                  : slot === "speaking" ? t("quickControls.uploadSpeaking") : t("quickControls.uploadSilent")}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  disabled={avatarUploading[slot]}
                  onChange={(e) => {
                    uploadAvatarImage(slot, e.target.files[0]);
                    e.target.value = "";
                  }}
                  style={{ display: "none" }}
                />
              </label>
              {avatarError[slot] && (
                <span style={styles.avatarErrorText}>{avatarError[slot]}</span>
              )}
            </div>
          ))}
        </div>

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
                  <span style={styles.avatarErrorText}>⚠ {elevenVoicesStatus}</span>
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
                  <span style={styles.avatarErrorText}>{t("quickControls.piperMissing")}</span>
                )}
                {piperStatus && !["loading", "ok", "missing"].includes(piperStatus) && (
                  <span style={styles.avatarErrorText}>⚠ {piperStatus}</span>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <div style={styles.hint}>{t("quickControls.hint")}</div>
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
  verticalTitle: {
    writingMode: "vertical-rl",
    fontWeight: 700,
    fontSize: 13,
    color: "var(--text)",
    whiteSpace: "nowrap",
    marginTop: 10,
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
  avatarPreviewWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  },
  avatarPreview: {
    width: "100%",
    aspectRatio: "1 / 1",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--surface2)",
    backgroundSize: "contain",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPreviewEmpty: {
    color: "var(--text-muted)",
    fontSize: 11,
  },
  avatarPreviewLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  avatarUploadRow: {
    display: "flex",
    gap: 8,
  },
  avatarUploadCol: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  uploadLabel: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    padding: "6px 4px",
    fontSize: 11,
    fontWeight: 600,
    textAlign: "center",
  },
  avatarErrorText: {
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
