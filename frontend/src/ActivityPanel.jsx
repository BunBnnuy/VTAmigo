import React from "react";
import { useTranslation } from "./i18n/index.js";

const KIND_ICON = {
  follow: "💜",
  sub: "⭐",
  resub: "🔁",
  giftsub: "🎁",
  raid: "🚀",
  cheer: "💎",
  redeem: "🏆",
};

const KIND_COLOR = {
  follow: "var(--purple)",
  sub: "var(--yellow)",
  resub: "var(--yellow)",
  giftsub: "var(--yellow)",
  raid: "var(--green)",
  cheer: "var(--purple-light)",
  redeem: "var(--purple)",
};

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function describeEvent(event, t) {
  switch (event.kind) {
    case "follow":
      return t("activityPanel.follow");
    case "sub":
      return t(event.isGift ? "activityPanel.subGift" : "activityPanel.sub", { tier: event.tier });
    case "resub":
      return t(event.months === 1 ? "activityPanel.resubOne" : "activityPanel.resubMany", { months: event.months });
    case "giftsub":
      return t(event.count === 1 ? "activityPanel.giftSubOne" : "activityPanel.giftSubMany", { count: event.count });
    case "raid":
      return t(event.viewers === 1 ? "activityPanel.raidOne" : "activityPanel.raidMany", { viewers: event.viewers });
    case "cheer":
      return t("activityPanel.cheer", { bits: event.bits });
    case "redeem":
      return t("activityPanel.redeem", { reward: event.rewardTitle });
    default:
      return t("activityPanel.default");
  }
}

export default function ActivityPanel({ events = [], lang }) {
  const { t } = useTranslation(lang);
  const sorted = [...events].reverse();

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>{t("activityPanel.title")}</span>
        <span style={styles.count}>{events.length}</span>
      </div>
      <div style={styles.list}>
        {sorted.length === 0 && (
          <div style={styles.empty}>{t("activityPanel.empty")}</div>
        )}
        {sorted.map((event) => (
          <div key={event.id} style={{ ...styles.row, borderLeftColor: KIND_COLOR[event.kind] || "var(--border)" }}>
            <span style={styles.icon}>{KIND_ICON[event.kind] || "✨"}</span>
            <div style={styles.rowBody}>
              <div style={styles.rowTop}>
                <span style={styles.username}>{event.username || t("activityPanel.anonymous")}</span>
                <span style={styles.time}>{formatTime(event.timestamp)}</span>
              </div>
              <div style={styles.desc}>{describeEvent(event, t)}</div>
              {event.message && <div style={styles.message}>&quot;{event.message}&quot;</div>}
              {event.kind === "redeem" && event.text && <div style={styles.message}>&quot;{event.text}&quot;</div>}
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
  title: {
    fontWeight: 700,
    fontSize: 13,
    color: "var(--purple-light)",
  },
  count: {
    marginLeft: "auto",
    fontSize: 11,
    color: "var(--text-muted)",
    background: "var(--surface2)",
    borderRadius: 10,
    padding: "1px 8px",
  },
  list: {
    flex: 1,
    overflowY: "auto",
    padding: "10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  empty: {
    color: "var(--text-muted)",
    textAlign: "center",
    marginTop: 40,
    fontSize: 13,
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
    fontSize: 16,
    lineHeight: 1,
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
  username: {
    fontWeight: 700,
    fontSize: 13,
    color: "var(--text)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  time: {
    fontSize: 10,
    color: "var(--text-muted)",
    flexShrink: 0,
  },
  desc: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 2,
  },
  message: {
    fontSize: 12,
    color: "var(--text)",
    fontStyle: "italic",
    marginTop: 4,
  },
};
