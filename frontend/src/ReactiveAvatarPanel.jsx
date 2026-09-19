import React, { useEffect, useState } from "react";
import { Check, Copy, Mic, MicOff, Upload } from "lucide-react";
import { apiFetch, apiUrl } from "./api.js";
import { reactiveAvatar } from "./ReactiveAvatarController.js";
import { useTranslation } from "./i18n/index.js";

// Independent from AvatarPanel/TTSController. This panel only listens to the
// streamer's local microphone and sends activity state to the reactive avatar
// overlay. It does not transcribe, speak, or affect the bot avatar.
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
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

export default function ReactiveAvatarPanel({ lang }) {
  const { t } = useTranslation(lang);
  const [enabled, setEnabled] = useState(reactiveAvatar.enabled);
  const [speaking, setSpeaking] = useState(reactiveAvatar.speaking);
  const [error, setError] = useState(reactiveAvatar.error);
  const [overlayUrl, setOverlayUrl] = useState("");
  const [overlayToken, setOverlayToken] = useState("");
  const [status, setStatus] = useState({ hasSpeaking: false, hasSilent: false });
  const [previews, setPreviews] = useState({ speaking: null, silent: null });
  const [uploading, setUploading] = useState({ speaking: false, silent: false });
  const [uploadErrors, setUploadErrors] = useState({ speaking: "", silent: "" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const sync = () => {
      setEnabled(reactiveAvatar.enabled);
      setSpeaking(reactiveAvatar.speaking);
      setError(reactiveAvatar.error);
    };
    reactiveAvatar.onStateChange = sync;
    sync();
    return () => {
      if (reactiveAvatar.onStateChange === sync) reactiveAvatar.onStateChange = null;
    };
  }, []);

  useEffect(() => {
    apiFetch("/avatar/reactive/overlay-url")
      .then((res) => res.json())
      .then((data) => {
        setOverlayUrl(data.url || "");
        setOverlayToken(data.token || "");
        setStatus({ hasSpeaking: !!data.hasSpeaking, hasSilent: !!data.hasSilent });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const sendState = (path) => apiFetch(path, { method: "POST" }).catch(() => {});
    sendState(speaking ? "/avatar/reactive/start" : "/avatar/reactive/stop");
    return undefined;
  }, [enabled, speaking]);

  const toggle = async () => {
    if (reactiveAvatar.enabled) {
      reactiveAvatar.stop();
      await apiFetch("/avatar/reactive/stop", { method: "POST" }).catch(() => {});
      return;
    }
    await reactiveAvatar.start();
    if (!reactiveAvatar.enabled) setError(reactiveAvatar.error);
  };

  const copyOverlay = async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const imageSrc = (slot) => {
    if (previews[slot]) return previews[slot];
    const hasImage = slot === "speaking" ? status.hasSpeaking : status.hasSilent;
    if (!hasImage || !overlayToken) return null;
    return apiUrl(`/overlay/avatar-reactive/image?slot=${slot}&token=${encodeURIComponent(overlayToken)}`);
  };

  const uploadImage = (slot, file) => {
    if (!file) return;
    setUploadErrors((prev) => ({ ...prev, [slot]: "" }));
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setUploadErrors((prev) => ({ ...prev, [slot]: t("reactiveAvatarPanel.badFormat") }));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setUploadErrors((prev) => ({ ...prev, [slot]: t("reactiveAvatarPanel.tooLarge") }));
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setPreviews((prev) => ({ ...prev, [slot]: dataUrl }));
      setUploading((prev) => ({ ...prev, [slot]: true }));
      try {
        const response = await apiFetch("/avatar/reactive/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot, dataUrl }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        setStatus({ hasSpeaking: !!data.hasSpeaking, hasSilent: !!data.hasSilent });
      } catch (uploadError) {
        setUploadErrors((prev) => ({ ...prev, [slot]: t("reactiveAvatarPanel.uploadError", { error: uploadError.message }) }));
      } finally {
        setUploading((prev) => ({ ...prev, [slot]: false }));
      }
    };
    reader.onerror = () => setUploadErrors((prev) => ({ ...prev, [slot]: t("reactiveAvatarPanel.readError", { file: file.name }) }));
    reader.readAsDataURL(file);
  };

  const previewSlot = speaking ? "speaking" : "silent";
  const previewSrc = imageSrc(previewSlot);

  return (
    <div style={styles.body}>
      <div style={styles.intro}>
        <Mic size={18} />
        <span>{t("reactiveAvatarPanel.intro")}</span>
      </div>

      <div style={styles.toggleRow}>
        <span>{enabled ? t("reactiveAvatarPanel.enabled") : t("reactiveAvatarPanel.disabled")}</span>
        <Toggle
          checked={enabled}
          onChange={toggle}
          label={enabled ? t("reactiveAvatarPanel.enabled") : t("reactiveAvatarPanel.disabled")}
        />
      </div>

      <div style={{ ...styles.status, color: speaking ? "var(--accent)" : "var(--text-muted)" }}>
        {speaking ? <Mic size={15} /> : <MicOff size={15} />}
        <span>{speaking ? t("reactiveAvatarPanel.speaking") : t("reactiveAvatarPanel.silent")}</span>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.previewWrap}>
        <div
          style={{
            ...styles.preview,
            backgroundImage: previewSrc ? `url("${previewSrc.replace(/"/g, "%22")}")` : "none",
          }}
        >
          {!previewSrc && <span style={styles.previewEmpty}>—</span>}
        </div>
        <span style={styles.previewLabel}>
          {speaking ? <Mic size={14} /> : <MicOff size={14} />} {speaking ? t("reactiveAvatarPanel.speaking") : t("reactiveAvatarPanel.silent")}
        </span>
      </div>

      <button
        type="button"
        style={styles.copyButton}
        onClick={copyOverlay}
        disabled={!overlayUrl}
        title={t("reactiveAvatarPanel.copyOverlayTitle")}
      >
        {copied ? <Check size={14} color="var(--accent)" /> : <Copy size={14} color="var(--accent)" />}
        {copied ? t("reactiveAvatarPanel.copied") : t("reactiveAvatarPanel.copyOverlay")}
      </button>

      <div style={styles.uploadRow}>
        {["speaking", "silent"].map((slot) => (
          <div key={slot} style={styles.uploadCol}>
            <label
              style={{
                ...styles.uploadLabel,
                cursor: uploading[slot] ? "default" : "pointer",
                opacity: uploading[slot] ? 0.6 : 1,
              }}
            >
              {!uploading[slot] && <Upload size={14} color="var(--accent)" />}
              {uploading[slot]
                ? t("reactiveAvatarPanel.uploading")
                : slot === "speaking" ? t("reactiveAvatarPanel.uploadSpeaking") : t("reactiveAvatarPanel.uploadSilent")}
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                disabled={uploading[slot]}
                onChange={(event) => {
                  uploadImage(slot, event.target.files[0]);
                  event.target.value = "";
                }}
                style={{ display: "none" }}
              />
            </label>
            {uploadErrors[slot] && <span style={styles.error}>{uploadErrors[slot]}</span>}
          </div>
        ))}
      </div>

      <div style={styles.hint}>
        {t("reactiveAvatarPanel.hint")}
      </div>
    </div>
  );
}

const styles = {
  body: { display: "flex", flexDirection: "column", gap: 14, padding: 14, overflowY: "auto" },
  intro: { display: "flex", gap: 8, alignItems: "flex-start", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.4 },
  toggleRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontWeight: 600 },
  toggle: { width: 38, height: 22, borderRadius: 11, padding: 3, display: "flex", alignItems: "center", justifyContent: "flex-start", flexShrink: 0 },
  toggleKnob: { width: 16, height: 16, flexShrink: 0, borderRadius: "50%", transition: "transform 0.15s" },
  status: { display: "flex", gap: 7, alignItems: "center", fontSize: 13, fontWeight: 700 },
  error: { color: "var(--red)", fontSize: 11, lineHeight: 1.4 },
  copyButton: { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", justifyContent: "center" },
  previewWrap: { display: "flex", flexDirection: "column", alignItems: "center", gap: 6 },
  preview: {
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
  previewEmpty: { color: "var(--text-muted)", fontSize: 11 },
  previewLabel: { display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)", fontSize: 11 },
  uploadRow: { display: "flex", gap: 8 },
  uploadCol: { flex: 1, display: "flex", flexDirection: "column", gap: 4 },
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
  hint: { borderTop: "1px solid var(--border)", paddingTop: 10, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 },
};
