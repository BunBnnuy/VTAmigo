import React, { useEffect, useState } from "react";
import { Check, Copy, Mic, MicOff } from "lucide-react";
import { apiFetch } from "./api.js";
import { reactiveAvatar } from "./ReactiveAvatarController.js";
import { useTranslation } from "./i18n/index.js";

// Independent from AvatarPanel/TTSController. This panel only listens to the
// streamer's local microphone and sends activity state to the reactive avatar
// overlay. It does not transcribe, speak, or affect the bot avatar.
export default function ReactiveAvatarPanel({ lang }) {
  const { t } = useTranslation(lang);
  const [enabled, setEnabled] = useState(reactiveAvatar.enabled);
  const [speaking, setSpeaking] = useState(reactiveAvatar.speaking);
  const [error, setError] = useState(reactiveAvatar.error);
  const [overlayUrl, setOverlayUrl] = useState("");
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
    apiFetch("/overlay/avatar/overlay-url")
      .then((res) => res.json())
      .then((data) => setOverlayUrl(data.url || ""))
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

  return (
    <div style={styles.body}>
      <div style={styles.intro}>
        <Mic size={18} />
        <span>{t("reactiveAvatarPanel.intro")}</span>
      </div>

      <label style={styles.toggleRow}>
        <input type="checkbox" checked={enabled} onChange={toggle} />
        <span>{enabled ? t("reactiveAvatarPanel.enabled") : t("reactiveAvatarPanel.disabled")}</span>
      </label>

      <div style={{ ...styles.status, color: speaking ? "var(--accent)" : "var(--text-muted)" }}>
        {speaking ? <Mic size={15} /> : <MicOff size={15} />}
        <span>{speaking ? t("reactiveAvatarPanel.speaking") : t("reactiveAvatarPanel.silent")}</span>
      </div>

      {error && <div style={styles.error}>{error}</div>}

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

      <div style={styles.hint}>
        {t("reactiveAvatarPanel.hint")}
      </div>
    </div>
  );
}

const styles = {
  body: { display: "flex", flexDirection: "column", gap: 14, padding: 14, overflowY: "auto" },
  intro: { display: "flex", gap: 8, alignItems: "flex-start", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.4 },
  toggleRow: { display: "flex", gap: 8, alignItems: "center", cursor: "pointer", fontWeight: 600 },
  status: { display: "flex", gap: 7, alignItems: "center", fontSize: 13, fontWeight: 700 },
  error: { color: "var(--red)", fontSize: 11, lineHeight: 1.4 },
  copyButton: { background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", justifyContent: "center" },
  hint: { borderTop: "1px solid var(--border)", paddingTop: 10, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 },
};
