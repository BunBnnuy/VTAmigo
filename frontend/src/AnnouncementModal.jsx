import React, { useEffect, useRef } from "react";
import { Sparkles, AlertTriangle, Wrench, Trash2 } from "lucide-react";
import { useTranslation } from "./i18n/index.js";

const KIND_ICON = { action: AlertTriangle, fixed: Wrench, removed: Trash2 };
// The "you have to do something" section is the only one that earns an alarm
// colour; the rest are informational and stay neutral so it keeps its weight.
const KIND_COLOR = { action: "var(--yellow)", fixed: "var(--green)", removed: "var(--text-muted)" };

export default function AnnouncementModal({ announcement, lang, onClose }) {
  const { t } = useTranslation(lang);
  const okRef = useRef(null);

  // Focus the only action so Enter/Space dismisses without reaching for the
  // mouse — this sits in front of the whole app on launch.
  useEffect(() => {
    okRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!announcement) return null;

  return (
    <div style={styles.backdrop} role="presentation">
      <div style={styles.modal} role="dialog" aria-modal="true" aria-labelledby="announcement-title">
        <div style={styles.header}>
          <Sparkles size={18} color="var(--accent)" aria-hidden="true" />
          <h2 id="announcement-title" style={styles.title}>{t("announcement.title")}</h2>
        </div>

        <div style={styles.body}>
          {announcement.sections.map((section) => {
            const Icon = KIND_ICON[section.kind];
            const color = KIND_COLOR[section.kind];
            return (
              <section key={section.kind} style={styles.section}>
                <div style={styles.sectionHead}>
                  {Icon && <Icon size={15} color={color} aria-hidden="true" />}
                  <h3 style={{ ...styles.sectionTitle, color }}>{t(`announcement.headings.${section.kind}`)}</h3>
                </div>
                <ul style={styles.list}>
                  {section.items.map((item) => (
                    <li key={item} style={styles.item}>
                      {t(`announcement.${announcement.version}.${section.kind}.${item}`)}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div style={styles.footer}>
          <button ref={okRef} onClick={onClose} style={styles.ok}>
            {t("announcement.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1100, // above the onboarding tour's 1000
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modal: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    boxShadow: "var(--shadow)",
    width: "min(560px, 100%)",
    maxHeight: "min(80vh, 720px)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "14px 18px",
    borderBottom: "1px solid var(--border)",
  },
  title: { margin: 0, fontSize: 16, color: "var(--text)" },
  body: { padding: "6px 18px 2px", overflowY: "auto" },
  section: { marginBottom: 14 },
  sectionHead: { display: "flex", alignItems: "center", gap: 6, margin: "12px 0 6px" },
  sectionTitle: { margin: 0, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em" },
  list: { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 },
  item: { fontSize: 13, lineHeight: 1.5, color: "var(--text)" },
  footer: {
    display: "flex",
    justifyContent: "flex-end",
    padding: "12px 18px",
    borderTop: "1px solid var(--border)",
  },
  ok: {
    background: "var(--accent)",
    color: "var(--on-accent)",
    border: "none",
    borderRadius: 8,
    padding: "8px 22px",
    fontSize: 14,
    cursor: "pointer",
  },
};
