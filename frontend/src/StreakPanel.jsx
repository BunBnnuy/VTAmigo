import React, { useState, useEffect } from "react";
import { Link2, Check, Play, Flame, AlertTriangle } from "lucide-react";
import { apiFetch } from "./api.js";
import { useTranslation } from "./i18n/index.js";

// Content only — outer window chrome (drag/resize/collapse) is provided by
// WindowManager.jsx's shared <Window>. Controls the watch-streak overlay: the
// OBS URL, a test trigger, and the last milestone seen on the channel.
//
// Streaks themselves are not produced here: Twitch announces them as IRC
// USERNOTICEs (backend/streaks.js + sessions.js handleUserNotice), and the
// panel only mirrors the last one the app received over the /chat WS.
export default function StreakPanel({ lastStreak, lang }) {
  const { t } = useTranslation(lang);

  const [overlayUrl, setOverlayUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [testName, setTestName] = useState("");
  const [testStreak, setTestStreak] = useState("5");
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");

  useEffect(() => {
    apiFetch("/streak/overlay-url")
      .then((res) => res.json())
      .then((data) => setOverlayUrl(data.url || ""))
      .catch(() => {});
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
