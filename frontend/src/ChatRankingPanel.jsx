import React, { useCallback, useEffect, useState } from "react";
import { Clipboard, RefreshCw, Trophy } from "lucide-react";
import { apiFetch } from "./api.js";
import { useTranslation } from "./i18n/index.js";

const REFRESH_MS = 15000;

function normaliseRanking(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5);
}

export default function ChatRankingPanel({ lang }) {
  const { t } = useTranslation(lang);
  const [ranking, setRanking] = useState([]);
  const [overlayUrl, setOverlayUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const loadRanking = useCallback(async () => {
    try {
      const response = await apiFetch("/xp/ranking?limit=5");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setRanking(normaliseRanking(data.ranking));
      setError("");
    } catch {
      setError(t("chatRankingPanel.error"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/xp/ranking-overlay-url")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!cancelled) setOverlayUrl(data.url || "");
      })
      .catch(() => {});

    loadRanking();
    const timer = setInterval(loadRanking, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [loadRanking]);

  const copyOverlay = async () => {
    if (!overlayUrl || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={styles.panel}>
      <div style={styles.toolbar}>
        <div style={styles.heading}>
          <Trophy size={17} color="var(--yellow)" />
          <span>{t("chatRankingPanel.heading")}</span>
        </div>
        <button
          type="button"
          style={styles.refreshButton}
          onClick={loadRanking}
          title={t("chatRankingPanel.refresh")}
          aria-label={t("chatRankingPanel.refresh")}
        >
          <RefreshCw size={14} color="var(--accent)" />
        </button>
      </div>

      <div style={styles.list} aria-live="polite">
        {loading && <div style={styles.message}>{t("chatRankingPanel.loading")}</div>}
        {!loading && error && <div style={styles.error}>{error}</div>}
        {!loading && !error && ranking.length === 0 && (
          <div style={styles.message}>{t("chatRankingPanel.empty")}</div>
        )}
        {!loading && !error && ranking.map((user, index) => (
          <div key={user.usernameLower || user.username || index} style={styles.row}>
            <span style={styles.position}>#{index + 1}</span>
            <span style={{ ...styles.name, color: user.color || "var(--text)" }}>
              {user.username || "Usuario"}
            </span>
            <span style={styles.stats}>{t("chatRankingPanel.stats", { level: user.level, xp: user.xp })}</span>
          </div>
        ))}
      </div>

      <button
        type="button"
        style={{ ...styles.copyButton, opacity: overlayUrl ? 1 : 0.5 }}
        onClick={copyOverlay}
        disabled={!overlayUrl}
      >
        <Clipboard size={14} color="var(--accent)" />
        {copied ? t("chatRankingPanel.copied") : t("chatRankingPanel.copyOverlay")}
      </button>
      <div style={styles.hint}>{t("chatRankingPanel.hint")}</div>
    </div>
  );
}

const styles = {
  panel: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    padding: 14,
    boxSizing: "border-box",
    color: "var(--text)",
    background: "var(--surface)",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingBottom: 10,
    borderBottom: "1px solid var(--border)",
  },
  heading: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    fontSize: 14,
    fontWeight: 700,
  },
  refreshButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    padding: 0,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 7,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    padding: "12px 0",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "28px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 7,
    minHeight: 34,
    padding: "6px 8px",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
  },
  position: {
    color: "var(--text-muted)",
    fontSize: 12,
    fontWeight: 700,
  },
  name: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    fontWeight: 700,
  },
  stats: {
    color: "var(--text-muted)",
    fontSize: 11,
    whiteSpace: "nowrap",
  },
  message: {
    padding: "24px 8px",
    color: "var(--text-muted)",
    fontSize: 13,
    textAlign: "center",
  },
  error: {
    padding: "24px 8px",
    color: "var(--red)",
    fontSize: 13,
    textAlign: "center",
  },
  copyButton: {
    width: "100%",
    justifyContent: "center",
    padding: "9px 12px",
    background: "transparent",
    color: "var(--accent)",
    border: "1.5px solid var(--accent)",
    borderRadius: 9,
    fontWeight: 700,
  },
  hint: {
    marginTop: 8,
    color: "var(--text-muted)",
    fontSize: 11,
    lineHeight: 1.35,
    textAlign: "center",
  },
};
