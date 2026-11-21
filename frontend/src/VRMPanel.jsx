import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2, Play, Save } from "lucide-react";
import { apiFetch } from "./api.js";
import { useTranslation } from "./i18n/index.js";

// Control window for the standalone VRM lab and its OBS overlay. Everything
// here is the same config the lab itself reads/writes (GET/POST /vrm-lab/config),
// so changes made in either place show up in the other on next load.
export default function VRMPanel({ lang }) {
  const { t } = useTranslation(lang);

  const [config, setConfig] = useState(null);
  const [idleClips, setIdleClips] = useState([]);
  const [overlayUrl, setOverlayUrl] = useState("");
  const [modelDraft, setModelDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [ttsOutput, setTtsOutput] = useState("app");
  const [testStatus, setTestStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch("/vrm-lab/config").then((res) => (res.ok ? res.json() : null)),
      fetch("/vrm-lab/animations.json").then((res) => (res.ok ? res.json() : [])),
      apiFetch("/overlay/avatar/overlay-url").then((res) => (res.ok ? res.json() : null)),
    ])
      .then(([cfg, clips, overlay]) => {
        if (cancelled) return;
        if (cfg) {
          setConfig(cfg);
          setModelDraft(cfg.modelUrl || "");
        }
        setIdleClips((clips || []).filter((clip) => clip.category === "idle"));
        if (overlay?.token) {
          setOverlayUrl(
            `${window.location.origin}/vrm-overlay.html?token=${encodeURIComponent(overlay.token)}`
          );
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The app keeps its settings in localStorage, so the panel can read the voice
  // output directly and warn when the overlay would receive nothing.
  useEffect(() => {
    const read = () => {
      try {
        const saved = JSON.parse(localStorage.getItem("settings") || "{}");
        setTtsOutput(saved.ttsOutput || "app");
      } catch {
        setTtsOutput("app");
      }
    };
    read();
    const timer = window.setInterval(read, 3000);
    window.addEventListener("focus", read);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, []);

  const save = useCallback(async (patch) => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await apiFetch("/vrm-lab/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setConfig(data);
      setModelDraft(data.modelUrl || "");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }, []);

  // Fires the same tts_speak broadcast the bot uses, so the overlay can be
  // tested without waiting for an AI line. The voice fields mirror the app's
  // settings (localStorage is the client's source of truth).
  const testOverlay = useCallback(async () => {
    setTestStatus("");
    try {
      const saved = JSON.parse(localStorage.getItem("settings") || "{}");
      const res = await apiFetch("/tts/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "Hola, esta es una prueba del overlay VRM.",
          voiceURI: saved.voiceURI || null,
          piperVoice: saved.piperVoice || null,
          kittenVoice: saved.kittenVoice || null,
          kokoroVoice: saved.kokoroVoice || null,
          fishVoice: saved.fishVoice || null,
          ttsProvider: saved.ttsProvider || "windows",
          rate: saved.ttsRate || 1,
          volume: saved.ttsVolume != null ? saved.ttsVolume : 1,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setTestStatus("ok");
      window.setTimeout(() => setTestStatus(""), 2000);
    } catch (err) {
      setTestStatus(err.message);
    }
  }, []);

  const copyOverlay = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the input is selectable when the clipboard API is unavailable */
    }
  }, [overlayUrl]);

  return (
    <div style={styles.body}>
      <div style={styles.row}>
        <a style={styles.secondaryBtn} href="/vrm-lab.html" target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> {t("vrmPanel.openLab")}
        </a>
        <span style={styles.status}>
          {saving ? <Loader2 size={13} className="spin" /> : saved ? <Check size={13} /> : null}
          {saved ? t("vrmPanel.saved") : ""}
        </span>
      </div>

      <label style={styles.label}>
        {t("vrmPanel.model")}
        <input
          type="url"
          value={modelDraft}
          placeholder={t("vrmPanel.modelPlaceholder")}
          onChange={(e) => setModelDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save({ modelUrl: modelDraft.trim() })}
        />
      </label>
      <button
        style={styles.primaryBtn}
        onClick={() => save({ modelUrl: modelDraft.trim() })}
        disabled={saving}
      >
        <Save size={13} /> {t("vrmPanel.save")}
      </button>

      <label style={styles.label}>
        {t("vrmPanel.idle")}
        <select
          value={config?.idleClip || ""}
          onChange={(e) => save({ idleClip: e.target.value })}
          disabled={saving || !config}
        >
          <option value="">{t("vrmPanel.idleProcedural")}</option>
          {idleClips.map((clip) => (
            <option key={clip.id} value={clip.id}>
              {clip.label}
            </option>
          ))}
        </select>
      </label>

      <label style={styles.checkRow}>
        <input
          type="checkbox"
          checked={config?.autoClips !== false}
          onChange={(e) => save({ autoClips: e.target.checked })}
          disabled={saving || !config}
        />
        {t("vrmPanel.autoClips")}
      </label>
      <label style={styles.checkRow}>
        <input
          type="checkbox"
          checked={!!config?.varyIdle}
          onChange={(e) => save({ varyIdle: e.target.checked })}
          disabled={saving || !config}
        />
        {t("vrmPanel.varyIdle")}
      </label>

      <label style={styles.label}>
        {t("vrmPanel.overlay")}
        <span style={styles.row}>
          <input readOnly value={overlayUrl} onFocus={(e) => e.target.select()} />
          <button style={styles.secondaryBtn} onClick={copyOverlay} disabled={!overlayUrl}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? t("vrmPanel.copied") : t("vrmPanel.copy")}
          </button>
        </span>
      </label>
      <div style={styles.row}>
        <a
          style={{ ...styles.secondaryBtn, flex: 1 }}
          href={overlayUrl ? `${overlayUrl}&debug=1` : "#"}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={13} /> {t("vrmPanel.openDebug")}
        </a>
        <button style={styles.secondaryBtn} onClick={testOverlay}>
          {testStatus === "ok" ? <Check size={13} /> : <Play size={13} />}
          {testStatus === "ok" ? t("vrmPanel.testSent") : t("vrmPanel.testOverlay")}
        </button>
      </div>
      {testStatus && testStatus !== "ok" && <span style={styles.error}>{testStatus}</span>}

      {ttsOutput === "app" && (
        <span style={styles.warn}>{t("vrmPanel.outputWarning")}</span>
      )}
      {error && <span style={styles.error}>{error}</span>}
      <span style={styles.hint}>{t("vrmPanel.troubleshoot")}</span>
      <span style={styles.hint}>{t("vrmPanel.hint")}</span>
    </div>
  );
}

const styles = {
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    height: "100%",
    overflowY: "auto",
    fontSize: 12,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 11.5,
    color: "var(--text-muted)",
  },
  checkRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    fontSize: 11.5,
    lineHeight: 1.4,
    color: "var(--text-muted)",
    cursor: "pointer",
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    color: "var(--green)",
    marginLeft: "auto",
  },
  primaryBtn: {
    background: "var(--accent)",
    color: "var(--on-accent)",
    borderRadius: 9,
    padding: "6px 10px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
  },
  secondaryBtn: {
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    padding: "6px 10px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 600,
    textDecoration: "none",
    width: "100%",
    boxSizing: "border-box",
  },
  hint: {
    fontSize: 10.5,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  },
  error: {
    fontSize: 11,
    color: "var(--red)",
  },
  warn: {
    fontSize: 11,
    lineHeight: 1.45,
    color: "var(--yellow)",
  },
};
