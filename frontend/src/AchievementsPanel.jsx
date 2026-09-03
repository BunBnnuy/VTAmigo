import React from "react";
import { Trophy, Lock, Check } from "lucide-react";
import { useTranslation } from "./i18n/index.js";

const CATEGORY_ORDER = ["connection", "ai", "chat", "events", "setup"];

// Content only — outer window chrome (drag/resize/collapse) is provided by
// WindowManager.jsx's shared <Window>. Progress/points come from
// GET /achievements/state (owned by App.jsx); this panel only renders them.
export default function AchievementsPanel({
  achievements = [],
  totalPoints = 0,
  earnedTier = "free",
  tierThresholds = null,
  lang,
}) {
  const { t } = useTranslation(lang);

  const thresholds = tierThresholds || { free: 0, basic: 50, advanced: 150, pro: 300 };
  const ranked = Object.entries(thresholds).sort((a, b) => a[1] - b[1]);
  const next = ranked.find(([, needed]) => needed > totalPoints) || null;

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    items: achievements.filter((a) => a.category === category),
  })).filter((g) => g.items.length > 0);

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.points}>
          <Trophy size={16} color="var(--yellow)" /> {t("achievementsPanel.points", { points: totalPoints })}
        </span>
        <span style={styles.tier}>{t("achievementsPanel.tier", { tier: earnedTier })}</span>
      </div>
      {next ? (
        <div style={styles.nextWrap} title={t("achievementsPanel.nextTitle", { tier: next[0] })}>
          <div style={styles.nextLabel}>
            {t("achievementsPanel.nextTier", { tier: next[0], points: totalPoints, needed: next[1] })}
          </div>
          <div style={styles.nextTrack}>
            <div
              style={{
                ...styles.nextFill,
                width: `${Math.min(100, Math.round((totalPoints / next[1]) * 100))}%`,
              }}
            />
          </div>
        </div>
      ) : (
        <div style={styles.nextWrap}>
          <div style={styles.nextLabel}>{t("achievementsPanel.maxTier")}</div>
        </div>
      )}
      <div style={styles.list}>
        {achievements.length === 0 && (
          <div style={styles.empty}>{t("achievementsPanel.loading")}</div>
        )}
        {groups.map(({ category, items }) => (
          <div key={category}>
            <div style={styles.category}>{t(`achievementsPanel.categories.${category}`)}</div>
            <div style={styles.group}>
              {items.map((a) => (
                <div
                  key={a.id}
                  style={{
                    ...styles.row,
                    borderLeftColor: a.unlocked ? "var(--green)" : "var(--border)",
                    opacity: a.unlocked ? 1 : 0.85,
                  }}
                >
                  <span style={styles.icon}>
                    {a.unlocked
                      ? <Check size={16} color="var(--green)" />
                      : <Lock size={16} />}
                  </span>
                  <div style={styles.rowBody}>
                    <div style={styles.rowTop}>
                      <span style={styles.name}>{t(`achievementsPanel.items.${a.id}.name`)}</span>
                      <span style={styles.pts}>+{a.points}</span>
                    </div>
                    <div style={styles.desc}>{t(`achievementsPanel.items.${a.id}.desc`)}</div>
                    {a.target > 1 && (
                      <div style={styles.progWrap}>
                        <div style={styles.progTrack}>
                          <div
                            style={{
                              ...styles.progFill,
                              background: a.unlocked ? "var(--green)" : "var(--accent)",
                              width: `${Math.min(100, Math.round((a.progress / a.target) * 100))}%`,
                            }}
                          />
                        </div>
                        <span style={styles.progLabel}>
                          {t("achievementsPanel.progress", { done: a.progress, target: a.target })}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  panel: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border)",
  },
  points: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontWeight: 700,
    fontSize: 13,
    color: "var(--text)",
  },
  tier: {
    marginLeft: "auto",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--accent-light)",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 10,
    padding: "1px 8px",
    textTransform: "capitalize",
  },
  nextWrap: {
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
  },
  nextLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginBottom: 6,
  },
  nextTrack: {
    height: 6,
    borderRadius: 3,
    background: "var(--border)",
    overflow: "hidden",
  },
  nextFill: {
    height: "100%",
    background: "var(--accent)",
    borderRadius: 3,
  },
  list: {
    flex: 1,
    overflowY: "auto",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  empty: {
    color: "var(--text-muted)",
    textAlign: "center",
    marginTop: 40,
    fontSize: 13,
  },
  category: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    marginBottom: 6,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  row: {
    display: "flex",
    gap: 8,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderLeft: "3px solid",
    borderRadius: 6,
    padding: "8px 10px",
  },
  icon: {
    lineHeight: 1,
    paddingTop: 1,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTop: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 6,
  },
  name: {
    fontWeight: 700,
    fontSize: 13,
    color: "var(--text)",
  },
  pts: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--yellow)",
    flexShrink: 0,
  },
  desc: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 2,
  },
  progWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  progTrack: {
    flex: 1,
    height: 5,
    borderRadius: 3,
    background: "var(--border)",
    overflow: "hidden",
  },
  progFill: {
    height: "100%",
    borderRadius: 3,
  },
  progLabel: {
    fontSize: 10,
    color: "var(--text-muted)",
    flexShrink: 0,
  },
};
