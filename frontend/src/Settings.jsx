import React, { useState, useEffect, useRef } from "react";
import { tts } from "./TTSController.js";
import { voice, isChromeBrowser } from "./VoiceTranscription.js";
import { apiFetch, apiUrl } from "./api.js";
import { useTranslation, SUPPORTED_LANGUAGES } from "./i18n/index.js";
import { tierLimits, clampToTier } from "./tiers.js";
import { DEFAULT_BASE_PROMPT } from "./promptDefaults.js";

const TIER_NAMES = { free: "Free", basic: "Basic", advanced: "Advanced", pro: "Pro" };
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function formatWindowLabel(sec) {
  if (sec < 60) return `${sec}s`;
  const min = sec / 60;
  return `${min} min`;
}

export default function Settings({ settings, tier, onSave, onClose }) {
  const [form, setForm] = useState(() => ({ ...settings, ...clampToTier(tier, settings) }));
  const limits = tierLimits(tier);
  const { t } = useTranslation(form.language);
  const micChromeAllowed = voice.supported && isChromeBrowser();
  const [voices, setVoices] = useState([]);
  const [micDevices, setMicDevices] = useState([]);
  const [elevenVoices, setElevenVoices] = useState([]);
  const [elevenVoicesStatus, setElevenVoicesStatus] = useState(""); // "", "loading", "error message"
  const [piperVoices, setPiperVoices] = useState([]);
  const [piperStatus, setPiperStatus] = useState(""); // "", "loading", "ok", "missing", "error message"
  const [exportTarget, setExportTarget] = useState("");
  const [exportStatus, setExportStatus] = useState(null); // null | {running, pct, stage, error, mdPath}
  const [importFile, setImportFile] = useState(null); // { name, content }
  const [importStatus, setImportStatus] = useState(null); // null | {running, error, ok}
  const [downloadMemoryStatus, setDownloadMemoryStatus] = useState({ running: false, pct: 0, stage: "", error: null, markdown: null, availableAt: 0 });
  const downloadTriggeredRef = useRef(false);
  const [overlayUrl, setOverlayUrl] = useState("");
  const [overlayCopied, setOverlayCopied] = useState(false);
  const [chatOverlayUrl, setChatOverlayUrl] = useState("");
  const [chatOverlayCopied, setChatOverlayCopied] = useState(false);
  const [avatarOverlayUrl, setAvatarOverlayUrl] = useState("");
  const [avatarOverlayToken, setAvatarOverlayToken] = useState("");
  const [avatarOverlayCopied, setAvatarOverlayCopied] = useState(false);
  const [avatarStatus, setAvatarStatus] = useState({ hasSpeaking: false, hasSilent: false });
  const [avatarPreviews, setAvatarPreviews] = useState({ speaking: null, silent: null }); // slot -> local data URL, once (re)uploaded this session
  const [avatarUploading, setAvatarUploading] = useState({ speaking: false, silent: false });
  const [avatarError, setAvatarError] = useState({ speaking: "", silent: "" });
  const [botLogin, setBotLogin] = useState(null); // currently-linked bot account's login, or null
  const [botLinkStatus, setBotLinkStatus] = useState("idle"); // idle | starting | waiting | linked | expired | error
  const [botLinkUrl, setBotLinkUrl] = useState("");
  const [botLinkCopied, setBotLinkCopied] = useState(false);
  const botLinkPollRef = useRef(null);
  const botLinkTokenRef = useRef(null);

  const refreshBotLogin = () => {
    apiFetch("/auth/me")
      .then((res) => res.json())
      .then((data) => setBotLogin(data.botLogin || null))
      .catch(() => {});
  };

  useEffect(() => {
    apiFetch("/xp/overlay-url")
      .then((res) => res.json())
      .then((data) => setOverlayUrl(data.url || ""))
      .catch(() => {});
    apiFetch("/chat-overlay/overlay-url")
      .then((res) => res.json())
      .then((data) => setChatOverlayUrl(data.url || ""))
      .catch(() => {});
    apiFetch("/overlay/avatar/overlay-url")
      .then((res) => res.json())
      .then((data) => {
        setAvatarOverlayUrl(data.url || "");
        setAvatarOverlayToken(data.token || "");
        setAvatarStatus({ hasSpeaking: !!data.hasSpeaking, hasSilent: !!data.hasSilent });
      })
      .catch(() => {});
    refreshBotLogin();
    return () => {
      if (botLinkPollRef.current) clearInterval(botLinkPollRef.current);
    };
  }, []);

  const stopBotLinkPoll = () => {
    if (botLinkPollRef.current) {
      clearInterval(botLinkPollRef.current);
      botLinkPollRef.current = null;
    }
  };

  const startBotLink = async () => {
    setBotLinkStatus("starting");
    try {
      const res = await apiFetch("/bot-link/init", { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      botLinkTokenRef.current = data.linkToken;
      setBotLinkUrl(data.url);
      setBotLinkStatus("waiting");
      stopBotLinkPoll();
      botLinkPollRef.current = setInterval(async () => {
        try {
          const pollRes = await apiFetch(`/bot-link/poll?linkToken=${encodeURIComponent(botLinkTokenRef.current)}`);
          const pollData = await pollRes.json();
          if (pollData.status === "linked") {
            stopBotLinkPoll();
            setBotLinkStatus("linked");
            setBotLogin(pollData.botLogin);
          } else if (pollData.status === "expired") {
            stopBotLinkPoll();
            setBotLinkStatus("expired");
          }
        } catch {
          // transient network hiccup — keep polling until it either succeeds or the interval is stopped
        }
      }, 2500);
    } catch {
      setBotLinkStatus("error");
    }
  };

  const cancelBotLink = () => {
    stopBotLinkPoll();
    if (botLinkTokenRef.current) {
      apiFetch("/bot-link/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkToken: botLinkTokenRef.current }),
      }).catch(() => {});
    }
    setBotLinkStatus("idle");
    setBotLinkUrl("");
  };

  const unlinkBot = async () => {
    stopBotLinkPoll();
    try {
      await apiFetch("/bot-link/unlink", { method: "POST" });
    } catch {
      // best-effort — refreshBotLogin() below will reflect the real state either way
    }
    setBotLinkStatus("idle");
    refreshBotLogin();
  };

  const copyBotLinkUrl = async () => {
    try {
      await navigator.clipboard.writeText(botLinkUrl);
      setBotLinkCopied(true);
      setTimeout(() => setBotLinkCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can still select the text manually.
    }
  };

  const copyOverlayUrl = async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setOverlayCopied(true);
      setTimeout(() => setOverlayCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can still select the text manually.
    }
  };

  const copyChatOverlayUrl = async () => {
    try {
      await navigator.clipboard.writeText(chatOverlayUrl);
      setChatOverlayCopied(true);
      setTimeout(() => setChatOverlayCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can still select the text manually.
    }
  };

  const copyAvatarOverlayUrl = async () => {
    try {
      await navigator.clipboard.writeText(avatarOverlayUrl);
      setAvatarOverlayCopied(true);
      setTimeout(() => setAvatarOverlayCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can still select the text manually.
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
      setAvatarError((prev) => ({ ...prev, [slot]: t("settings.avatarOverlay.badType") }));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError((prev) => ({ ...prev, [slot]: t("settings.avatarOverlay.tooLarge") }));
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
        setAvatarError((prev) => ({ ...prev, [slot]: t("settings.avatarOverlay.uploadError", { error: err.message }) }));
      } finally {
        setAvatarUploading((prev) => ({ ...prev, [slot]: false }));
      }
    };
    reader.onerror = () => setAvatarError((prev) => ({ ...prev, [slot]: t("settings.avatarOverlay.uploadError", { error: file.name }) }));
    reader.readAsDataURL(file);
  };

  // Poll export progress while a job is running
  useEffect(() => {
    if (!exportStatus?.running) return;
    const timer = setInterval(async () => {
      try {
        const res = await apiFetch("/memory/export/status");
        setExportStatus(await res.json());
      } catch {
        // Backend unreachable — keep last known state and retry
      }
    }, 700);
    return () => clearInterval(timer);
  }, [exportStatus?.running]);

  const startMemoryExport = async (from, to) => {
    try {
      const res = await apiFetch("/memory/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setExportStatus({ running: true, pct: 0, stage: t("settings.aiProvider.initiating"), error: null, mdPath: null });
    } catch (err) {
      setExportStatus({ running: false, pct: 0, stage: "", error: err.message, mdPath: null });
    }
  };

  const handleMemoryFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImportFile({ name: file.name, content: String(reader.result || "") });
    reader.onerror = () => setImportStatus({ running: false, error: t("settings.copySettings.readError", { file: file.name }) });
    reader.readAsText(file);
  };

  const importMemoryFile = async () => {
    if (!importFile) return;
    setImportStatus({ running: true, error: null, ok: false });
    try {
      const res = await apiFetch("/memory/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: importFile.content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setImportStatus({ running: false, error: null, ok: true });
    } catch (err) {
      setImportStatus({ running: false, error: err.message, ok: false });
    }
  };

  useEffect(() => {
    apiFetch("/memory/download/status")
      .then((r) => r.json())
      .then(setDownloadMemoryStatus)
      .catch(() => {});
  }, []);

  const triggerMemoryFileDownload = (markdown) => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vtamigo-memory-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Poll download progress while a job is running — the CLI dump can take a
  // couple of minutes, so the backend runs it as a background job instead of
  // one long request (which risked hitting nginx's proxy timeout).
  useEffect(() => {
    if (!downloadMemoryStatus.running) return;
    const timer = setInterval(async () => {
      try {
        const res = await apiFetch("/memory/download/status");
        const data = await res.json();
        setDownloadMemoryStatus(data);
        if (!data.running && data.markdown && !downloadTriggeredRef.current) {
          downloadTriggeredRef.current = true;
          triggerMemoryFileDownload(data.markdown);
        }
      } catch {
        // Backend unreachable — keep last known state and retry
      }
    }, 700);
    return () => clearInterval(timer);
  }, [downloadMemoryStatus.running]);

  const downloadMemories = async () => {
    downloadTriggeredRef.current = false;
    try {
      const res = await apiFetch("/memory/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        setDownloadMemoryStatus((s) => ({ ...s, running: false, error: data.error, availableAt: data.availableAt || s.availableAt }));
        return;
      }
      setDownloadMemoryStatus((s) => ({ ...s, running: true, pct: 0, stage: t("settings.aiProvider.downloadStarting"), error: null, markdown: null }));
    } catch (err) {
      setDownloadMemoryStatus((s) => ({ ...s, running: false, error: err.message }));
    }
  };

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

  // Auto-load ElevenLabs voices when opening settings with a saved key
  useEffect(() => {
    if (settings.ttsProvider === "elevenlabs" && settings.elevenLabsKey) {
      loadElevenVoices(settings.elevenLabsKey);
    }
    if (settings.ttsProvider === "piper") loadPiperVoices();
  }, []);

  useEffect(() => {
    const load = () => setVoices(tts.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
  }, []);

  useEffect(() => {
    const loadMicDevices = async () => {
      try {
        // Request permission first so labels are populated
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMicDevices(devices.filter((d) => d.kind === "audioinput"));
      } catch {
        // Permission denied — list will be empty
      }
    };
    loadMicDevices();
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Settings live in this origin's localStorage only, so moving from e.g. the
  // local app to a VPS-hosted instance needs an explicit export/import round trip.
  const [settingsFileStatus, setSettingsFileStatus] = useState(null); // null | {error} | {ok}

  const exportSettings = () => {
    const blob = new Blob([JSON.stringify(form, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vtamigo-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importSettingsFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        // backendUrl isn't exposed anywhere in this UI, so a stale value from
        // an old backup (e.g. a domain this app moved away from) would
        // silently redirect every API call — including login — to a dead
        // origin with no way to notice or clear it. Drop it if it doesn't
        // match where we're actually running.
        let droppedStaleBackendUrl = false;
        if (parsed.backendUrl && parsed.backendUrl.replace(/\/+$/, "") !== window.location.origin) {
          delete parsed.backendUrl;
          droppedStaleBackendUrl = true;
        }
        setForm((f) => ({ ...f, ...parsed }));
        setSettingsFileStatus({ ok: true, droppedStaleBackendUrl });
      } catch (err) {
        setSettingsFileStatus({ error: t("settings.copySettings.invalidFile", { error: err.message }) });
      }
    };
    reader.onerror = () => setSettingsFileStatus({ error: t("settings.copySettings.readError", { file: file.name }) });
    reader.readAsText(file);
    e.target.value = ""; // allow re-selecting the same file later
  };

  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <span style={styles.title}>{t("settings.title")}</span>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={styles.body}>
          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>{t("settings.language.title")}</h3>
            <div style={styles.field}>
              <label>{t("settings.language.label")}</label>
              <select value={form.language || "en"} onChange={(e) => set("language", e.target.value)}>
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
              <span style={styles.hint}>{t("settings.language.hint")}</span>
            </div>
          </section>

          <section style={{ ...styles.section, ...styles.disabledSection }}>
            <h3 style={styles.sectionTitle}>{t("settings.tiktok.title")}</h3>
            <div style={styles.field}>
              <label>{t("settings.tiktok.label")}</label>
              <input
                value={form.tiktokUsername || ""}
                onChange={(e) => set("tiktokUsername", e.target.value)}
                placeholder="@username"
              />
              <span style={styles.hint}>{t("settings.tiktok.hint")}</span>
            </div>
          </section>

          <section style={styles.section} data-tour="bot-account">
            <h3 style={styles.sectionTitle}>{t("settings.bot.title")}</h3>

            {botLogin ? (
              <div style={styles.field}>
                <span style={styles.hint}>{t("settings.bot.linkedAs")} <strong>{botLogin}</strong></span>
                <button type="button" onClick={unlinkBot} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "nowrap" }}>
                  {t("settings.bot.unlink")}
                </button>
              </div>
            ) : botLinkStatus === "waiting" ? (
              <div style={styles.field}>
                <span style={styles.hint}>{t("settings.bot.waitingHint")}</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input readOnly value={botLinkUrl} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
                  <button type="button" onClick={copyBotLinkUrl} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "nowrap" }}>
                    {botLinkCopied ? t("settings.overlay.copied") : t("settings.overlay.copy")}
                  </button>
                </div>
                <button type="button" onClick={cancelBotLink} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "nowrap" }}>
                  {t("settings.bot.cancel")}
                </button>
              </div>
            ) : (
              <div style={styles.field}>
                <button type="button" onClick={startBotLink} disabled={botLinkStatus === "starting"} style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "nowrap" }}>
                  {botLinkStatus === "starting" ? "…" : t("settings.bot.connect")}
                </button>
                {botLinkStatus === "expired" && <span style={styles.hint}>{t("settings.bot.expired")}</span>}
                {botLinkStatus === "error" && <span style={styles.hint}>{t("settings.bot.error")}</span>}
                <span style={styles.hint}>{t("settings.bot.connectHint")}</span>
              </div>
            )}

            <span style={styles.hint}>{t("settings.bot.autoSendHint")}</span>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>{t("settings.ignoredUsers.title")}</h3>
            <div style={styles.field}>
              <label>{t("settings.ignoredUsers.label")}</label>
              <input
                value={form.ignoredUsers || ""}
                onChange={(e) => set("ignoredUsers", e.target.value)}
                placeholder="nightbot, streamelements, jonejo_ia"
              />
              <span style={styles.hint}>{t("settings.ignoredUsers.hint")}</span>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>{t("settings.overlay.title")}</h3>
            <div style={styles.field}>
              <label>{t("settings.overlay.label")}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input readOnly value={overlayUrl} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={copyOverlayUrl}
                  disabled={!overlayUrl}
                  style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "nowrap" }}
                >
                  {overlayCopied ? t("settings.overlay.copied") : t("settings.overlay.copy")}
                </button>
              </div>
              <span style={styles.hint}>{t("settings.overlay.hint")}</span>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>{t("settings.chatOverlay.title")}</h3>
            <div style={styles.field}>
              <label>{t("settings.chatOverlay.label")}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input readOnly value={chatOverlayUrl} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={copyChatOverlayUrl}
                  disabled={!chatOverlayUrl}
                  style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "nowrap" }}
                >
                  {chatOverlayCopied ? t("settings.chatOverlay.copied") : t("settings.chatOverlay.copy")}
                </button>
              </div>
              <span style={styles.hint}>{t("settings.chatOverlay.hint")}</span>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>{t("settings.avatarOverlay.title")}</h3>
            <div style={styles.field}>
              <label>{t("settings.avatarOverlay.urlLabel")}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input readOnly value={avatarOverlayUrl} onFocus={(e) => e.target.select()} style={{ flex: 1 }} />
                <button
                  type="button"
                  onClick={copyAvatarOverlayUrl}
                  disabled={!avatarOverlayUrl}
                  style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "nowrap" }}
                >
                  {avatarOverlayCopied ? t("settings.avatarOverlay.copied") : t("settings.avatarOverlay.copy")}
                </button>
              </div>
              <span style={styles.hint}>{t("settings.avatarOverlay.urlHint")}</span>
            </div>

            <div style={styles.row2}>
              {["speaking", "silent"].map((slot) => {
                const src = avatarImageSrc(slot);
                return (
                  <div key={slot} style={styles.field}>
                    <label>{t(`settings.avatarOverlay.${slot}Label`)}</label>
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: "1 / 1",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--surface2)",
                        backgroundImage: src ? `url("${src.replace(/"/g, "%22")}")` : "none",
                        backgroundSize: "contain",
                        backgroundPosition: "center",
                        backgroundRepeat: "no-repeat",
                        marginBottom: 8,
                      }}
                    >
                      {!src && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 11 }}>
                          —
                        </div>
                      )}
                    </div>
                    <label
                      style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: avatarUploading[slot] ? "default" : "pointer",
                        borderRadius: 6,
                        padding: "6px 0",
                        opacity: avatarUploading[slot] ? 0.6 : 1,
                      }}
                    >
                      {avatarUploading[slot] ? t("settings.avatarOverlay.uploading") : t("settings.avatarOverlay.upload")}
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
                      <span style={{ ...styles.hint, color: "var(--danger, #ff6b6b)" }}>❌ {avatarError[slot]}</span>
                    )}
                  </div>
                );
              })}
            </div>
            <span style={styles.hint}>{t("settings.avatarOverlay.hint")}</span>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>
              {t("settings.batching.title")} <span style={styles.comingSoon}>{TIER_NAMES[tier] || tier}</span>
            </h3>
            <div style={styles.row2}>
              <div style={styles.field}>
                <label>{t("settings.batching.windowSize")}</label>
                {limits.windowOptions ? (
                  <select value={form.batchWindow} onChange={(e) => set("batchWindow", Number(e.target.value))}>
                    {limits.windowOptions.map((sec) => (
                      <option key={sec} value={sec}>{formatWindowLabel(sec)}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={form.batchWindow}
                    onChange={(e) => set("batchWindow", Number(e.target.value))}
                  />
                )}
              </div>
              <div style={styles.field}>
                <label>{t("settings.batching.maxMessages")}</label>
                {limits.messageOptions ? (
                  <select value={form.maxMessages} onChange={(e) => set("maxMessages", Number(e.target.value))}>
                    {limits.messageOptions.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={form.maxMessages}
                    onChange={(e) => set("maxMessages", Number(e.target.value))}
                  />
                )}
              </div>
            </div>
            <div style={styles.field}>
              <label>{t("settings.batching.responseStyle")}</label>
              <select value={form.style} onChange={(e) => set("style", e.target.value)}>
                <option value="auto">{t("settings.batching.styleAuto")}</option>
                <option value="chatbot">{t("settings.batching.styleChatbot")}</option>
                <option value="narrator">{t("settings.batching.styleNarrator")}</option>
              </select>
            </div>
          </section>

          <section style={{ ...styles.section, ...styles.disabledSection }}>
            <fieldset disabled style={styles.disabledFieldset}>
              <h3 style={styles.sectionTitle}>{t("settings.reddit.title")} <span style={styles.comingSoon}>{t("settings.reddit.disabled")}</span></h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <input
                  type="checkbox"
                  id="idleReddit"
                  checked={false}
                  onChange={() => {}}
                  style={{ width: "auto", accentColor: "var(--purple)" }}
                />
                <label htmlFor="idleReddit" style={{ margin: 0, color: "var(--text)", fontSize: 13 }}>
                  {t("settings.reddit.enableLabel")}
                </label>
              </div>
              <div style={styles.field}>
                <label>{t("settings.reddit.thresholdLabel")}</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={form.idleStoryThreshold ?? 7}
                  onChange={(e) => set("idleStoryThreshold", Number(e.target.value))}
                />
                <span style={styles.hint}>
                  {t("settings.reddit.thresholdHint", {
                    minutes: Math.round((form.idleStoryThreshold ?? 7) * (form.batchWindow ?? 20) / 60),
                    window: form.batchWindow ?? 20,
                  })}
                </span>
              </div>
              <div style={styles.field}>
                <label>{t("settings.reddit.subredditsLabel")}</label>
                <input
                  value={form.subreddits ?? "HistoriasDeReddit, AskRedditEsp, confesiones, anecdotasgraciosas, es"}
                  onChange={(e) => set("subreddits", e.target.value)}
                  placeholder="HistoriasDeReddit, AskRedditEsp, es"
                />
                <span style={styles.hint}>{t("settings.reddit.subredditsHint")}</span>
              </div>
            </fieldset>
          </section>

          <section style={{ ...styles.section, ...styles.disabledSection }}>
            <fieldset disabled style={styles.disabledFieldset}>
              <h3 style={styles.sectionTitle}>{t("settings.youtube.title")} <span style={styles.comingSoon}>{t("settings.youtube.disabled")}</span></h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <input
                  type="checkbox"
                  id="youtubePeek"
                  checked={false}
                  onChange={() => {}}
                  style={{ width: "auto", accentColor: "var(--purple)" }}
                />
                <label htmlFor="youtubePeek" style={{ margin: 0, color: "var(--text)", fontSize: 13 }}>
                  {t("settings.youtube.enableLabel")}
                </label>
              </div>
              <div style={styles.field}>
                <label>{t("settings.youtube.intervalLabel")}</label>
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={form.youtubePeekInterval ?? 5}
                  onChange={(e) => set("youtubePeekInterval", Number(e.target.value))}
                />
                <span style={styles.hint}>
                  {t("settings.youtube.intervalHint", {
                    interval: form.youtubePeekInterval ?? 5,
                    plural: (form.youtubePeekInterval ?? 5) !== 1 ? "s" : "",
                  })}
                </span>
              </div>
            </fieldset>
          </section>

          <section style={{ ...styles.section, ...styles.disabledSection }}>
            <fieldset disabled style={styles.disabledFieldset}>
              <h3 style={styles.sectionTitle}>{t("settings.trivia.title")} <span style={styles.comingSoon}>{t("settings.trivia.disabled")}</span></h3>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <input
                  type="checkbox"
                  id="screenWatch"
                  checked={false}
                  onChange={() => {}}
                  style={{ width: "auto", accentColor: "var(--purple)" }}
                />
                <label htmlFor="screenWatch" style={{ margin: 0, color: "var(--text)", fontSize: 13 }}>
                  {t("settings.trivia.enableLabel")}
                </label>
              </div>
              <div style={styles.row2}>
                <div style={styles.field}>
                  <label>{t("settings.trivia.captureInterval")}</label>
                  <input
                    type="number"
                    min={2}
                    max={30}
                    value={form.screenWatchInterval ?? 4}
                    onChange={(e) => set("screenWatchInterval", Number(e.target.value))}
                  />
                </div>
                <div style={styles.field}>
                  <label>{t("settings.trivia.waitChat")}</label>
                  <input
                    type="number"
                    min={5}
                    max={120}
                    value={form.screenWatchWindow ?? 20}
                    onChange={(e) => set("screenWatchWindow", Number(e.target.value))}
                  />
                </div>
              </div>
              <div style={styles.field}>
                <label>{t("settings.trivia.processLabel")}</label>
                <input
                  value={form.screenWatchProcess || ""}
                  onChange={(e) => set("screenWatchProcess", e.target.value)}
                  placeholder={t("settings.trivia.processPlaceholder")}
                />
                <span style={styles.hint}>{t("settings.trivia.processHint")}</span>
              </div>
              <div style={styles.field}>
                <label>{t("settings.trivia.regionLabel")}</label>
                <input
                  value={form.screenWatchRegion || ""}
                  onChange={(e) => set("screenWatchRegion", e.target.value)}
                  placeholder={t("settings.trivia.regionPlaceholder")}
                />
                <span style={styles.hint}>{t("settings.trivia.regionHint")}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <input
                  type="checkbox"
                  id="screenClick"
                  checked={form.screenClickEnabled || false}
                  onChange={(e) => set("screenClickEnabled", e.target.checked)}
                  style={{ width: "auto", accentColor: "var(--purple)" }}
                />
                <label htmlFor="screenClick" style={{ margin: 0, color: "var(--text)", fontSize: 13 }}>
                  {t("settings.trivia.autoClickLabel")}
                </label>
              </div>
              <div style={styles.field}>
                <label>{t("settings.trivia.clickTargetLabel")}</label>
                <select
                  value={form.screenClickTarget || "ai"}
                  onChange={(e) => set("screenClickTarget", e.target.value)}
                >
                  <option value="ai">{t("settings.trivia.clickTargetAI")}</option>
                  <option value="chat">{t("settings.trivia.clickTargetChat")}</option>
                </select>
                <span style={styles.hint}>{t("settings.trivia.clickHint")}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <input
                  type="checkbox"
                  id="screenAutoNav"
                  checked={form.screenAutoNavigate || false}
                  onChange={(e) => set("screenAutoNavigate", e.target.checked)}
                  style={{ width: "auto", accentColor: "var(--purple)" }}
                />
                <label htmlFor="screenAutoNav" style={{ margin: 0, color: "var(--text)", fontSize: 13 }}>
                  {t("settings.trivia.autoNavLabel")}
                </label>
              </div>
              <div style={styles.field}>
                <span style={styles.hint}>{t("settings.trivia.autoNavHint")}</span>
              </div>
              <div style={styles.field}>
                <button
                  style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", width: "100%" }}
                  type="button"
                  onClick={() => {
                    apiFetch("/screenwatch/test", { method: "POST" }).catch(() => {});
                    onClose();
                  }}
                >
                  {t("settings.trivia.testButton")}
                </button>
              </div>
            </fieldset>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>{t("settings.aiProvider.title")}</h3>
            <div style={{ ...styles.disabledSection, marginBottom: 12 }}>
            <fieldset disabled style={styles.disabledFieldset}>
            <div style={styles.field}>
              <label>{t("settings.aiProvider.providerLabel")} <span style={styles.comingSoon}>{t("settings.aiProvider.onlyClaude")}</span></label>
              <select value="claude" onChange={() => {}}>
                <option value="claude">Claude (claude -p)</option>
                <option value="grok">Grok (grok -p)</option>
                <option value="agy">AGY CLI (agy -p)</option>
                <option value="chatgpt">ChatGPT (OpenAI API)</option>
              </select>
            </div>
            {(() => {
              const current = form.provider || "claude";
              const targets = ["claude", "grok", "agy"].filter((p) => p !== current);
              const target = targets.includes(exportTarget) ? exportTarget : targets[0];
              const canExport = current !== "chatgpt" && !exportStatus?.running;
              const label = (p) => p.charAt(0).toUpperCase() + p.slice(1);
              return (
                <div style={styles.field}>
                  <label>{t("settings.aiProvider.exportMemoryLabel")}</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      value={target || ""}
                      onChange={(e) => setExportTarget(e.target.value)}
                      disabled={!canExport}
                      style={{ flex: 1 }}
                    >
                      {targets.map((p) => (
                        <option key={p} value={p}>{label(p)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => startMemoryExport(current, target)}
                      disabled={!canExport || !target}
                      style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        opacity: !canExport || !target ? 0.5 : 1,
                      }}
                    >
                      {exportStatus?.running ? t("settings.aiProvider.exporting") : t("settings.aiProvider.exportTo", { target: label(target || "") })}
                    </button>
                  </div>
                  {exportStatus && (exportStatus.running || exportStatus.pct > 0 || exportStatus.error) && (
                    <div style={{ marginTop: 8 }}>
                      <div
                        style={{
                          height: 10,
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderRadius: 5,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${exportStatus.pct || 0}%`,
                            background: exportStatus.error ? "#e05555" : "var(--purple)",
                            transition: "width 0.4s ease",
                          }}
                        />
                      </div>
                      <span style={{ ...styles.hint, marginTop: 4, display: "block" }}>
                        {exportStatus.error
                          ? `❌ ${exportStatus.error}`
                          : exportStatus.pct >= 100
                          ? `✅ ${exportStatus.stage}${exportStatus.mdPath ? ` — ${exportStatus.mdPath}` : ""}`
                          : `${exportStatus.stage} (${exportStatus.pct || 0}%)`}
                      </span>
                    </div>
                  )}
                  <span style={styles.hint}>{t("settings.aiProvider.exportHint")}</span>
                </div>
              );
            })()}
            </fieldset>
            </div>
            {(() => {
              const canImport = !!importFile && !importStatus?.running;
              return (
                <div style={styles.field}>
                  <label>{t("settings.aiProvider.importMemoryLabel")}</label>
                  <input type="file" accept=".md,text/markdown" onChange={handleMemoryFile} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      type="button"
                      onClick={() => importMemoryFile()}
                      disabled={!canImport}
                      style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        color: "var(--text)",
                        opacity: !canImport ? 0.5 : 1,
                        flex: 1,
                      }}
                    >
                      {importStatus?.running
                        ? t("settings.aiProvider.importing")
                        : t("settings.aiProvider.importButton", { file: importFile ? ` "${importFile.name}"` : "" })}
                    </button>
                  </div>
                  {importStatus && (importStatus.error || importStatus.ok) && (
                    <span style={{ ...styles.hint, marginTop: 4, display: "block" }}>
                      {importStatus.error ? `❌ ${importStatus.error}` : t("settings.aiProvider.importSuccess")}
                    </span>
                  )}
                  <span style={styles.hint}>{t("settings.aiProvider.importHint")}</span>
                </div>
              );
            })()}
            {(() => {
              const onCooldown = !downloadMemoryStatus.running && Date.now() < (downloadMemoryStatus.availableAt || 0);
              const canDownload = !onCooldown && !downloadMemoryStatus.running;
              return (
                <div style={styles.field}>
                  <label>{t("settings.aiProvider.downloadMemoryLabel")}</label>
                  <button
                    type="button"
                    onClick={() => downloadMemories()}
                    disabled={!canDownload}
                    style={{
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      opacity: !canDownload ? 0.5 : 1,
                      width: "100%",
                    }}
                  >
                    {downloadMemoryStatus.running
                      ? t("settings.aiProvider.downloading")
                      : t("settings.aiProvider.downloadMemoryButton")}
                  </button>
                  {downloadMemoryStatus.running && (
                    <div style={{ marginTop: 8 }}>
                      <div
                        style={{
                          height: 10,
                          background: "var(--surface2)",
                          border: "1px solid var(--border)",
                          borderRadius: 5,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${downloadMemoryStatus.pct || 0}%`,
                            background: "var(--purple)",
                            transition: "width 0.4s ease",
                          }}
                        />
                      </div>
                      <span style={{ ...styles.hint, marginTop: 4, display: "block" }}>
                        {downloadMemoryStatus.stage} ({downloadMemoryStatus.pct || 0}%)
                      </span>
                    </div>
                  )}
                  {!downloadMemoryStatus.running && downloadMemoryStatus.pct >= 100 && !downloadMemoryStatus.error && (
                    <span style={{ ...styles.hint, marginTop: 4, display: "block" }}>✅ {t("settings.aiProvider.downloadDone")}</span>
                  )}
                  {onCooldown && (
                    <span style={{ ...styles.hint, marginTop: 4, display: "block" }}>
                      {t("settings.aiProvider.downloadCooldown", { time: new Date(downloadMemoryStatus.availableAt).toLocaleString() })}
                    </span>
                  )}
                  {downloadMemoryStatus.error && (
                    <span style={{ ...styles.hint, marginTop: 4, display: "block" }}>
                      ❌ {downloadMemoryStatus.error === "COOLDOWN" ? t("settings.aiProvider.downloadCooldownError") : downloadMemoryStatus.error}
                    </span>
                  )}
                  <span style={styles.hint}>{t("settings.aiProvider.downloadMemoryHint")}</span>
                </div>
              );
            })()}
          </section>

          <section style={styles.section} data-tour="ai-prompt">
            <h3 style={styles.sectionTitle}>{t("settings.prompt.title")}</h3>
            <div style={styles.field}>
              <label>{t("settings.prompt.label")}</label>
              <textarea
                value={form.basePrompt || ""}
                onChange={(e) => set("basePrompt", e.target.value)}
                placeholder={DEFAULT_BASE_PROMPT}
                rows={7}
                style={styles.textarea}
              />
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>{t("settings.tts.title")}</h3>
            <div style={styles.field}>
              <label>{t("settings.tts.provider")}</label>
              <select
                value={form.ttsProvider || "windows"}
                onChange={(e) => {
                  set("ttsProvider", e.target.value);
                  if (e.target.value === "piper") loadPiperVoices();
                }}
              >
                <option value="windows">{t("settings.tts.windows")}</option>
                <option value="elevenlabs" disabled={form.ttsProvider !== "elevenlabs"}>
                  {t("settings.tts.elevenlabs")} {form.ttsProvider !== "elevenlabs" ? `(${t("settings.tts.unavailable")})` : ""}
                </option>
                <option value="piper">{t("settings.tts.piper")}</option>
              </select>
            </div>
            {(form.ttsProvider || "windows") === "windows" && (
              <div style={styles.field}>
                <label>{t("settings.tts.voice")}</label>
                <select value={form.voiceURI} onChange={(e) => set("voiceURI", e.target.value)}>
                  <option value="">{t("settings.tts.systemDefault")}</option>
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.ttsProvider === "elevenlabs" && (
              <>
                <div style={styles.field}>
                  <label>{t("settings.tts.elevenApiKey")}</label>
                  <input
                    type="password"
                    value={form.elevenLabsKey || ""}
                    onChange={(e) => set("elevenLabsKey", e.target.value)}
                    onBlur={() => loadElevenVoices(form.elevenLabsKey)}
                    placeholder="sk_xxxxxxxxxxxxxxxxxxxx"
                  />
                  <span style={styles.hint}>
                    {t("settings.tts.elevenApiKeyHintPrefix")}{" "}
                    <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noreferrer" style={styles.link}>
                      elevenlabs.io
                    </a>
                    {" "}{t("settings.tts.elevenApiKeyHintSuffix")}
                  </span>
                </div>
                <div style={styles.field}>
                  <label>{t("settings.tts.elevenVoice")}</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      value={form.elevenLabsVoiceId || ""}
                      onChange={(e) => set("elevenLabsVoiceId", e.target.value)}
                      style={{ flex: 1 }}
                    >
                      <option value="">{t("settings.tts.selectVoice")}</option>
                      {elevenVoices.map((v) => (
                        <option key={v.voice_id} value={v.voice_id}>
                          {v.name}{v.category ? ` (${v.category})` : ""}
                        </option>
                      ))}
                      {form.elevenLabsVoiceId && !elevenVoices.some((v) => v.voice_id === form.elevenLabsVoiceId) && (
                        <option value={form.elevenLabsVoiceId}>{form.elevenLabsVoiceId} {t("settings.tts.savedVoice")}</option>
                      )}
                    </select>
                    <button
                      type="button"
                      style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "nowrap" }}
                      onClick={() => loadElevenVoices(form.elevenLabsKey)}
                      disabled={!form.elevenLabsKey || elevenVoicesStatus === "loading"}
                    >
                      {elevenVoicesStatus === "loading" ? t("settings.tts.loading") : t("settings.tts.loadVoices")}
                    </button>
                  </div>
                  {elevenVoicesStatus && elevenVoicesStatus !== "loading" && (
                    <span style={{ ...styles.hint, color: "var(--red)" }}>⚠ {elevenVoicesStatus}</span>
                  )}
                </div>
                <div style={styles.field}>
                  <label>{t("settings.tts.pasteVoiceId")}</label>
                  <input
                    value={form.elevenLabsVoiceId || ""}
                    onChange={(e) => set("elevenLabsVoiceId", e.target.value.trim())}
                    placeholder="21m00Tcm4TlvDq8ikWAM"
                  />
                  <span style={styles.hint}>{t("settings.tts.pasteVoiceIdHint")}</span>
                </div>
              </>
            )}
            {form.ttsProvider === "piper" && (
              <div style={styles.field}>
                <label>{t("settings.tts.piperVoice")}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <select
                    value={form.piperVoice || ""}
                    onChange={(e) => set("piperVoice", e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">{t("settings.tts.piperDefault")}</option>
                    {piperVoices.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", whiteSpace: "nowrap" }}
                    onClick={loadPiperVoices}
                    disabled={piperStatus === "loading"}
                  >
                    {piperStatus === "loading" ? t("settings.tts.loading") : t("settings.tts.loadVoices")}
                  </button>
                </div>
                {piperStatus === "missing" && (
                  <span style={{ ...styles.hint, color: "var(--red)" }}>{t("settings.tts.piperMissing")}</span>
                )}
                {piperStatus && !["loading", "ok", "missing"].includes(piperStatus) && (
                  <span style={{ ...styles.hint, color: "var(--red)" }}>⚠ {piperStatus}</span>
                )}
                <span style={styles.hint}>{t("settings.tts.piperHint")}</span>
              </div>
            )}
            <div style={styles.row2}>
              <div style={styles.field}>
                <label>{t("settings.tts.speed", { rate: form.ttsRate })}</label>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={form.ttsRate}
                  onChange={(e) => set("ttsRate", Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--purple)" }}
                />
              </div>
              <div style={styles.field}>
                <label>{t("settings.tts.volume", { volume: Math.round(form.ttsVolume * 100) })}</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={form.ttsVolume}
                  onChange={(e) => set("ttsVolume", Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--purple)" }}
                />
              </div>
            </div>
          </section>

          <section style={{ ...styles.section, ...(!micChromeAllowed ? styles.grayedOutSection : {}) }}>
            <h3 style={styles.sectionTitle}>{t("settings.voice.title")}</h3>
            {!voice.supported && (
              <p style={{ ...styles.hint, color: "var(--red)", marginBottom: 10 }}>
                {t("settings.voice.unsupported")}
              </p>
            )}
            {voice.supported && !isChromeBrowser() && (
              <p style={{ ...styles.hint, color: "var(--red)", marginBottom: 10 }}>
                {t("settings.voice.chromeOnly")}
              </p>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <input
                type="checkbox"
                id="micEnabled"
                checked={form.micEnabled || false}
                onChange={(e) => set("micEnabled", e.target.checked)}
                style={{ width: "auto", accentColor: "var(--purple)" }}
                disabled={!micChromeAllowed}
              />
              <label htmlFor="micEnabled" style={{ margin: 0, color: "var(--text)", fontSize: 13 }}>
                {t("settings.voice.enableLabel")}
              </label>
            </div>
            <div style={styles.field}>
              <label>{t("settings.voice.micDevice")}</label>
              <select
                value={form.micDeviceId || ""}
                onChange={(e) => set("micDeviceId", e.target.value)}
                disabled={!micChromeAllowed}
              >
                <option value="">{t("settings.voice.systemDefault")}</option>
                {micDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || t("settings.voice.micFallback", { id: d.deviceId.slice(0, 8) })}
                  </option>
                ))}
              </select>
            </div>
            <div style={styles.row2}>
              <div style={styles.field}>
                <label>{t("settings.voice.language")}</label>
                <select
                  value={form.micLang || "es-ES"}
                  onChange={(e) => set("micLang", e.target.value)}
                  disabled={!micChromeAllowed}
                >
                  <option value="es-ES">Español (ES)</option>
                  <option value="es-MX">Español (MX)</option>
                  <option value="es-AR">Español (AR)</option>
                  <option value="en-US">English (US)</option>
                  <option value="en-GB">English (GB)</option>
                  <option value="pt-BR">Português (BR)</option>
                  <option value="fr-FR">Français</option>
                  <option value="de-DE">Deutsch</option>
                </select>
              </div>
              <div style={styles.field}>
                <label>{t("settings.voice.chatLabel")}</label>
                <input
                  value={form.micLabel || "Streamer"}
                  onChange={(e) => set("micLabel", e.target.value)}
                  placeholder={t("settings.voice.chatLabelPlaceholder")}
                  disabled={!micChromeAllowed}
                />
                <span style={styles.hint}>{t("settings.voice.chatLabelHint")}</span>
              </div>
            </div>
          </section>

          <section style={{ ...styles.section, ...styles.disabledSection }}>
            <h3 style={styles.sectionTitle}>{t("settings.copySettings.title")}</h3>
            <div style={styles.field}>
              <label>{t("settings.copySettings.label")}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={exportSettings}
                  style={{ background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", flex: 1 }}
                >
                  {t("settings.copySettings.download")}
                </button>
                <label
                  style={{
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    borderRadius: 6,
                  }}
                >
                  {t("settings.copySettings.upload")}
                  <input type="file" accept=".json,application/json" onChange={importSettingsFile} style={{ display: "none" }} />
                </label>
              </div>
              {settingsFileStatus && (
                <span style={{ ...styles.hint, marginTop: 4, display: "block" }}>
                  {settingsFileStatus.error
                    ? `❌ ${settingsFileStatus.error}`
                    : settingsFileStatus.droppedStaleBackendUrl
                    ? t("settings.copySettings.loadedOkDroppedBackend")
                    : t("settings.copySettings.loadedOk")}
                </span>
              )}
              <span style={styles.hint}>{t("settings.copySettings.hint")}</span>
            </div>
          </section>
        </div>

        <div style={styles.footer}>
          <button style={styles.cancelBtn} onClick={onClose}>{t("settings.cancel")}</button>
          <button style={styles.saveBtn} data-tour="save-apply" onClick={() => onSave(form)}>{t("settings.save")}</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  textarea: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    borderRadius: 6,
    padding: "8px 10px",
    fontFamily: "inherit",
    fontSize: 13,
    width: "100%",
    resize: "vertical",
    lineHeight: 1.6,
  },
  disabledSection: {
    opacity: 0.45,
    display: "none",
  },
  grayedOutSection: {
    opacity: 0.45,
    pointerEvents: "none",
  },
  disabledFieldset: {
    border: "none",
    padding: 0,
    margin: 0,
  },
  comingSoon: {
    fontSize: 10,
    fontWeight: 400,
    color: "var(--text-muted)",
    textTransform: "none",
    letterSpacing: "normal",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    width: 520,
    maxWidth: "95vw",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "16px 20px",
    borderBottom: "1px solid var(--border)",
  },
  title: {
    fontWeight: 700,
    fontSize: 16,
  },
  closeBtn: {
    background: "transparent",
    color: "var(--text-muted)",
    padding: "4px 8px",
    fontSize: 16,
  },
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  section: {},
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: "var(--purple-light)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 12,
  },
  field: {
    marginBottom: 12,
  },
  row2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 4,
    display: "block",
  },
  link: {
    color: "var(--purple-light)",
  },
  footer: {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
    padding: "14px 20px",
    borderTop: "1px solid var(--border)",
  },
  cancelBtn: {
    background: "var(--surface2)",
    color: "var(--text)",
  },
  saveBtn: {
    background: "var(--purple)",
    color: "#fff",
  },
};
