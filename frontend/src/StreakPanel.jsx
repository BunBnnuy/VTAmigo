import React, { useState, useEffect, useRef } from "react";
import { Link2, Check, Play, Pause, Flame, AlertTriangle, Upload, Trash2 } from "lucide-react";
import { apiFetch, apiUrl } from "./api.js";
import { channelGain } from "./mixer.js";
import { useTranslation } from "./i18n/index.js";

function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

// Content only — outer window chrome (drag/resize/collapse) is provided by
// WindowManager.jsx's shared <Window>. Controls the watch-streak overlay: the
// OBS URL, the optional alert sound, a test trigger, and the last milestone
// seen on the channel.
//
// Streaks themselves are not produced here: Twitch announces them as IRC
// USERNOTICEs (backend/streaks.js + sessions.js handleUserNotice), and the
// panel only mirrors the last one the app received over the /chat WS.
export default function StreakPanel({ lastStreak, mixer, lang }) {
  const { t } = useTranslation(lang);

  const [overlayUrl, setOverlayUrl] = useState("");
  const [overlayToken, setOverlayToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [testName, setTestName] = useState("");
  const [testStreak, setTestStreak] = useState("5");
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");

  const [audio, setAudio] = useState({ hasAudio: false });
  const [audioBusy, setAudioBusy] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [audioPlaying, setAudioPlaying] = useState(false);
  const fileInputRef = useRef(null);
  const previewRef = useRef(null);

  useEffect(() => {
    apiFetch("/streak/overlay-url")
      .then((res) => res.json())
      .then((data) => {
        setOverlayUrl(data.url || "");
        setOverlayToken(data.token || "");
      })
      .catch(() => {});

    apiFetch("/streak/audio/status")
      .then((res) => res.json())
      .then((data) => setAudio(data && typeof data === "object" ? data : { hasAudio: false }))
      .catch(() => {});
  }, []);

  // A preview clip must not keep playing after the panel is hidden/unmounted.
  useEffect(() => () => {
    if (previewRef.current) previewRef.current.pause();
  }, []);

  const copyOverlayUrl = async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — the URL is still visible for manual copy.
    }
  };

  const runTest = async (e) => {
    e.preventDefault();
    setTesting(true);
    setTestError("");
    try {
      const res = await apiFetch("/streak/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: testName.trim(),
          streak: Number(testStreak) || 5,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    } catch (err) {
      setTestError(err.message);
    } finally {
      setTesting(false);
    }
  };

  const stopPreview = () => {
    if (previewRef.current) {
      previewRef.current.pause();
      previewRef.current = null;
    }
    setAudioPlaying(false);
  };

  const togglePreview = () => {
    if (previewRef.current) {
      stopPreview();
      return;
    }
    if (!overlayToken) return;
    const player = new Audio(`${apiUrl("/streak/audio")}?token=${encodeURIComponent(overlayToken)}`);
    // Same gain the OBS overlay applies, so the preview matches the mix.
    player.volume = channelGain(mixer, "streakAlert");
    player.onended = () => {
      previewRef.current = null;
      setAudioPlaying(false);
    };
    previewRef.current = player;
    setAudioPlaying(true);
    player.play().catch(() => {
      previewRef.current = null;
      setAudioPlaying(false);
    });
  };

  const uploadAudio = async (file) => {
    if (!file) return;
    setAudioBusy(true);
    setAudioError("");
    try {
      const form = new FormData();
      form.append("audio", file);
      const res = await apiFetch("/streak/audio", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      stopPreview();
      setAudio(data);
    } catch (err) {
      setAudioError(err.message);
    } finally {
      setAudioBusy(false);
      // Allow re-selecting the same file after a failed attempt.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeAudio = async () => {
    setAudioBusy(true);
    setAudioError("");
    try {
      stopPreview();
      const res = await apiFetch("/streak/audio", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setAudio(data);
    } catch (err) {
      setAudioError(err.message);
    } finally {
      setAudioBusy(false);
    }
  };

  return (
    <>
      <div style={styles.body}>
        <button
          style={styles.actionBtn}
          onClick={copyOverlayUrl}
          disabled={!overlayUrl}
          title={t("streakPanel.copyOverlayTitle")}
        >
          {copied ? <Check size={14} color="var(--accent)" /> : <Link2 size={14} color="var(--accent)" />}{" "}
          {copied ? t("streakPanel.copied") : t("streakPanel.copyOverlay")}
        </button>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("streakPanel.testSection")}</div>
        <form onSubmit={runTest} style={styles.field}>
          <input
            type="text"
            value={testName}
            onChange={(e) => setTestName(e.target.value)}
            placeholder={t("streakPanel.testNamePlaceholder")}
            style={styles.input}
            maxLength={25}
          />
          <div style={styles.streakRow}>
            <label style={styles.rowLabel} htmlFor="streak-test-count">
              {t("streakPanel.testStreakLabel")}
            </label>
            <input
              id="streak-test-count"
              type="number"
              min={1}
              max={999}
              value={testStreak}
              onChange={(e) => setTestStreak(e.target.value)}
              style={styles.numberInput}
            />
          </div>
          <button type="submit" style={styles.actionBtn} disabled={testing}>
            {testing ? t("streakPanel.testing") : <><Play size={14} color="var(--accent)" /> {t("streakPanel.testButton")}</>}
          </button>
          {testError && (
            <span style={styles.errorText}>
              <AlertTriangle size={14} color="var(--yellow)" /> {t("streakPanel.testError", { error: testError })}
            </span>
          )}
        </form>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("streakPanel.audioSection")}</div>
        {audio.hasAudio ? (
          <div style={styles.audioBox}>
            <span style={styles.audioName} title={audio.name}>{audio.name}</span>
            <span style={styles.audioMeta}>{formatSize(audio.sizeBytes)}</span>
            <button type="button" style={styles.actionBtn} onClick={togglePreview} disabled={!overlayToken}>
              {audioPlaying
                ? <><Pause size={14} color="var(--accent)" /> {t("streakPanel.audioStop")}</>
                : <><Play size={14} color="var(--accent)" /> {t("streakPanel.audioPlay")}</>}
            </button>
          </div>
        ) : (
          <span style={styles.emptyText}>{t("streakPanel.audioNone")}</span>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/wav,audio/x-wav,audio/ogg,audio/webm,audio/*"
          style={{ display: "none" }}
          onChange={(e) => uploadAudio(e.target.files && e.target.files[0])}
        />
        <div style={styles.audioActions}>
          <button
            type="button"
            style={styles.actionBtn}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            disabled={audioBusy}
          >
            {audioBusy
              ? t("streakPanel.audioUploading")
              : <><Upload size={14} color="var(--accent)" /> {audio.hasAudio ? t("streakPanel.audioReplace") : t("streakPanel.audioUpload")}</>}
          </button>
          {audio.hasAudio && (
            <button type="button" style={styles.actionBtn} onClick={removeAudio} disabled={audioBusy}>
              <Trash2 size={14} color="var(--red)" /> {t("streakPanel.audioRemove")}
            </button>
          )}
        </div>
        {audioError && (
          <span style={styles.errorText}>
            <AlertTriangle size={14} color="var(--yellow)" /> {t("streakPanel.audioError", { error: audioError })}
          </span>
        )}
        <span style={styles.audioHint}>{t("streakPanel.audioHint")}</span>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("streakPanel.lastSection")}</div>
        {lastStreak ? (
          <div style={styles.lastBox}>
            <span style={styles.lastName}>
              <Flame size={14} color="var(--yellow)" /> {lastStreak.username}
            </span>
            <span style={styles.lastStreak}>
              {t("streakPanel.streakCount", { count: lastStreak.streak })}
            </span>
          </div>
        ) : (
          <span style={styles.emptyText}>{t("streakPanel.noStreak")}</span>
        )}
      </div>
      <div style={styles.hint}>{t("streakPanel.hint")}</div>
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
  rowLabel: {
    fontSize: 12,
    color: "var(--text)",
  },
  actionBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 10px",
    textAlign: "left",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  streakRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  input: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 4,
  },
  numberInput: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 4,
    width: 72,
  },
  audioBox: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  audioName: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  audioMeta: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  audioActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  audioHint: {
    fontSize: 10,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  },
  errorText: {
    fontSize: 10,
    color: "var(--red)",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  lastBox: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  lastName: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text)",
  },
  lastStreak: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  emptyText: {
    fontSize: 12,
    color: "var(--text-muted)",
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
  },
};
