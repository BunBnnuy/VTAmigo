import React, { useState, useEffect } from "react";
import { Mic, MicOff, Check, Link2, Upload } from "lucide-react";
import { apiFetch, apiUrl } from "./api.js";
import { useTranslation } from "./i18n/index.js";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

// Content only — outer window chrome (drag/resize/collapse) is provided by
// WindowManager.jsx's shared <Window>. Split out of QuickControls so the
// avatar images/preview get their own resizable window instead of fighting
// the toggles and voice pickers for room.
export default function AvatarPanel({ ttsSpeaking, lang }) {
  const { t } = useTranslation(lang);

  const [overlayUrl, setOverlayUrl] = useState("");
  const [overlayToken, setOverlayToken] = useState("");
  const [overlayCopied, setOverlayCopied] = useState(false);
  const [status, setStatus] = useState({ hasSpeaking: false, hasSilent: false });
  const [previews, setPreviews] = useState({ speaking: null, silent: null });
  const [uploading, setUploading] = useState({ speaking: false, silent: false });
  const [error, setError] = useState({ speaking: "", silent: "" });

  useEffect(() => {
    apiFetch("/overlay/avatar/overlay-url")
      .then((res) => res.json())
      .then((data) => {
        setOverlayUrl(data.url || "");
        setOverlayToken(data.token || "");
        setStatus({ hasSpeaking: !!data.hasSpeaking, hasSilent: !!data.hasSilent });
      })
      .catch(() => {});
  }, []);

  const copyOverlayUrl = async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setOverlayCopied(true);
      setTimeout(() => setOverlayCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can still copy from Settings instead.
    }
  };

  const imageSrc = (slot) => {
    if (previews[slot]) return previews[slot];
    const has = slot === "speaking" ? status.hasSpeaking : status.hasSilent;
    if (!has || !overlayToken) return null;
    return apiUrl(`/overlay/avatar/image?slot=${slot}&token=${overlayToken}`);
  };

  const uploadImage = (slot, file) => {
    if (!file) return;
    setError((prev) => ({ ...prev, [slot]: "" }));
    if (!ALLOWED_AVATAR_TYPES.includes(file.type)) {
      setError((prev) => ({ ...prev, [slot]: t("avatarPanel.badFormat") }));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setError((prev) => ({ ...prev, [slot]: t("avatarPanel.tooLarge") }));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      setPreviews((prev) => ({ ...prev, [slot]: dataUrl }));
      setUploading((prev) => ({ ...prev, [slot]: true }));
      try {
        const res = await apiFetch("/overlay/avatar/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slot, dataUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        setStatus({ hasSpeaking: !!data.hasSpeaking, hasSilent: !!data.hasSilent });
      } catch (err) {
        setError((prev) => ({ ...prev, [slot]: t("avatarPanel.uploadError", { error: err.message }) }));
      } finally {
        setUploading((prev) => ({ ...prev, [slot]: false }));
      }
    };
    reader.onerror = () => setError((prev) => ({ ...prev, [slot]: t("avatarPanel.readError", { file: file.name }) }));
    reader.readAsDataURL(file);
  };

  const previewSlot = ttsSpeaking ? "speaking" : "silent";
  const previewSrc = imageSrc(previewSlot);

  return (
    <>
      <div style={styles.body}>
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
            {ttsSpeaking ? <Mic size={14} /> : <MicOff size={14} />} {ttsSpeaking ? t("avatarPanel.speaking") : t("avatarPanel.silent")}
          </span>
        </div>

        <button
          style={styles.actionBtn}
          onClick={copyOverlayUrl}
          disabled={!overlayUrl}
          title={t("avatarPanel.copyOverlayTitle")}
        >
          {overlayCopied ? <Check size={14} color="var(--accent)" /> : <Link2 size={14} color="var(--accent)" />} {overlayCopied ? t("avatarPanel.copied") : t("avatarPanel.copyOverlay")}
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
                {!uploading[slot] && <Upload size={14} color="var(--accent)" />}{" "}
                {uploading[slot]
                  ? t("avatarPanel.uploading")
                  : slot === "speaking" ? t("avatarPanel.uploadSpeaking") : t("avatarPanel.uploadSilent")}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  disabled={uploading[slot]}
                  onChange={(e) => {
                    uploadImage(slot, e.target.files[0]);
                    e.target.value = "";
                  }}
                  style={{ display: "none" }}
                />
              </label>
              {error[slot] && <span style={styles.errorText}>{error[slot]}</span>}
            </div>
          ))}
        </div>
      </div>
      <div style={styles.hint}>{t("avatarPanel.hint")}</div>
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
  actionBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 10px",
    textAlign: "left",
  },
  previewWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  },
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
  previewEmpty: {
    color: "var(--text-muted)",
    fontSize: 11,
  },
  previewLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  uploadRow: {
    display: "flex",
    gap: 8,
  },
  uploadCol: {
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
  errorText: {
    fontSize: 10,
    color: "var(--red)",
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
  },
};
