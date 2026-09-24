import React, { useState, useEffect } from "react";
import { Link2, Check, Star, AlertTriangle, Play } from "lucide-react";
import { apiFetch } from "./api.js";
import { useTranslation } from "./i18n/index.js";

const MODES = ["recent-random", "top-random", "most-recent"];

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
// WindowManager.jsx's shared <Window>. Controls the !so shoutout overlay:
// the clip-selection mode, the banner, and a test trigger.
export default function ShoutoutPanel({ lastShoutout, lang }) {
  const { t } = useTranslation(lang);

  const [overlayUrl, setOverlayUrl] = useState("");
  const [overlayCopied, setOverlayCopied] = useState(false);
  const [config, setConfig] = useState(null);
  const [bannerInput, setBannerInput] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [testName, setTestName] = useState("");
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  const [initial, setInitial] = useState(null);

  useEffect(() => {
    apiFetch("/shoutout/overlay-url")
      .then((res) => res.json())
      .then((data) => setOverlayUrl(data.url || ""))
      .catch(() => {});

    apiFetch("/shoutout/config")
      .then((res) => res.json())
      .then((data) => {
        setConfig(data.config || null);
        setBannerInput((data.config && data.config.bannerText) || "");
      })
      .catch(() => setLoadError(true));

    apiFetch("/shoutout/state")
      .then((res) => res.json())
      .then((data) => setInitial(data.shoutout || null))
      .catch(() => {});
  }, []);

  const copyOverlayUrl = async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setOverlayCopied(true);
      setTimeout(() => setOverlayCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can still copy manually.
    }
  };

  // Optimistic: flip the control immediately, persist in the background, and
  // roll back to the server's answer if the save failed.
  const updateConfig = async (patch) => {
    const previous = config;
    setConfig((prev) => ({ ...prev, ...patch }));
    try {
      const res = await apiFetch("/shoutout/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setConfig(data.config);
    } catch {
      setConfig(previous);
      setLoadError(true);
    }
  };

  const runTest = async (e) => {
    e.preventDefault();
    setTesting(true);
    setTestError("");
    try {
      const res = await apiFetch("/shoutout/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: testName.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    } catch (err) {
      setTestError(err.message);
    } finally {
      setTesting(false);
    }
  };

  const current = lastShoutout || initial;

  return (
    <>
      <div style={styles.body}>
        <button
          style={styles.actionBtn}
          onClick={copyOverlayUrl}
          disabled={!overlayUrl}
          title={t("shoutoutPanel.copyOverlayTitle")}
        >
          {overlayCopied ? <Check size={14} color="var(--accent)" /> : <Link2 size={14} color="var(--accent)" />}{" "}
          {overlayCopied ? t("shoutoutPanel.copied") : t("shoutoutPanel.copyOverlay")}
        </button>

        {loadError && (
          <span style={styles.errorText}>
            <AlertTriangle size={14} color="var(--yellow)" /> {t("shoutoutPanel.loadError")}
          </span>
        )}

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("shoutoutPanel.modeSection")}</div>
        <select
          value={config?.mode || "recent-random"}
          onChange={(e) => updateConfig({ mode: e.target.value })}
          style={styles.select}
          disabled={!config}
        >
          {MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(
                mode === "top-random"
                  ? "shoutoutPanel.modeTopRandom"
                  : mode === "most-recent"
                    ? "shoutoutPanel.modeMostRecent"
                    : "shoutoutPanel.modeRecentRandom"
              )}
            </option>
          ))}
        </select>

        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("shoutoutPanel.showBanner")}</span>
          <Toggle
            checked={config?.showBanner !== false}
            onChange={() => updateConfig({ showBanner: !(config?.showBanner !== false) })}
          />
        </div>

        <div style={styles.sectionLabel}>{t("shoutoutPanel.bannerTextLabel")}</div>
        <input
          type="text"
          value={bannerInput}
          onChange={(e) => setBannerInput(e.target.value)}
          onBlur={() => {
            if (config && bannerInput !== config.bannerText) updateConfig({ bannerText: bannerInput });
          }}
          placeholder={t("shoutoutPanel.bannerPlaceholder")}
          style={styles.input}
          disabled={!config}
        />

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("shoutoutPanel.testSection")}</div>
        <form onSubmit={runTest} style={styles.field}>
          <input
            type="text"
            value={testName}
            onChange={(e) => setTestName(e.target.value)}
            placeholder={t("shoutoutPanel.testPlaceholder")}
            style={styles.input}
          />
          <button type="submit" style={styles.actionBtn} disabled={testing}>
            {testing ? t("shoutoutPanel.testing") : <><Play size={14} color="var(--accent)" /> {t("shoutoutPanel.testButton")}</>}
          </button>
          {testError && (
            <span style={styles.errorText}>
              <AlertTriangle size={14} color="var(--yellow)" /> {t("shoutoutPanel.testError", { error: testError })}
            </span>
          )}
        </form>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("shoutoutPanel.lastSection")}</div>
        {current ? (
          <div style={styles.lastBox}>
            <span style={styles.lastName}><Star size={14} color="var(--accent)" /> {current.username}</span>
            {current.clip?.title && <span style={styles.lastClip} title={current.clip.title}>{current.clip.title}</span>}
          </div>
        ) : (
          <span style={styles.emptyText}>{t("shoutoutPanel.noShoutout")}</span>
        )}
      </div>
      <div style={styles.hint}>{t("shoutoutPanel.hint")}</div>
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
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
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
  input: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 4,
  },
  select: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 4,
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
  lastClip: {
    fontSize: 11,
    color: "var(--text-muted)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
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
