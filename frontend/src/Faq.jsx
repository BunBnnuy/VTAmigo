import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { apiUrl } from "./api.js";
import { detectLanguage, SUPPORTED_LANGUAGES, useTranslation } from "./i18n/index.js";
import logo from "./img/logo.png";

// Same key Login.jsx persists the visitor's language under, so picking a
// language on the landing page carries over to this page and back.
const LANDING_LANG_KEY = "landingLang";

const ITEM_KEYS = ["what", "need", "approval", "vtube", "data"];

export default function Faq() {
  const [lang, setLang] = useState(() => localStorage.getItem(LANDING_LANG_KEY) || detectLanguage());
  const { t } = useTranslation(lang);
  const [openKey, setOpenKey] = useState(ITEM_KEYS[0]);

  const handleLangChange = (e) => {
    const next = e.target.value;
    setLang(next);
    localStorage.setItem(LANDING_LANG_KEY, next);
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <a href="/" style={styles.brand}>
          <img src={logo} alt="" style={styles.brandIcon} />
          <span style={styles.brandName}>VTAmigo</span>
        </a>
        <div style={styles.headerRight}>
          <select style={styles.langSelect} value={lang} onChange={handleLangChange} aria-label="Language">
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
          <a style={styles.headerBtn} href="/">{t("faq.back")}</a>
        </div>
      </header>

      <main style={styles.main}>
        <h1 style={styles.title}>{t("faq.title")}</h1>
        <p style={styles.subtitle}>{t("faq.subtitle")}</p>

        <div style={styles.list}>
          {ITEM_KEYS.map((key) => {
            const open = openKey === key;
            return (
              <div key={key} style={styles.item}>
                <button
                  style={styles.question}
                  onClick={() => setOpenKey(open ? null : key)}
                  aria-expanded={open}
                >
                  <span style={styles.questionText}>{t(`faq.items.${key}.q`)}</span>
                  <ChevronDown
                    size={18}
                    color="var(--accent)"
                    style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms" }}
                  />
                </button>
                {open && <p style={styles.answer}>{t(`faq.items.${key}.a`)}</p>}
              </div>
            );
          })}
        </div>

        <p style={styles.privacyNote}>
          <a href="/privacy" style={styles.link}>{t("faq.privacyLink")}</a>
        </p>

        <section style={styles.cta}>
          <h2 style={styles.ctaTitle}>{t("faq.ctaTitle")}</h2>
          <p style={styles.ctaBody}>{t("faq.ctaBody")}</p>
          <a style={styles.ctaBtn} href={apiUrl("/auth/twitch/login")}>{t("login.cta")}</a>
        </section>
      </main>

      <footer style={styles.footer}>
        <a href="/" style={styles.link}>{t("faq.home")}</a>
        <span>·</span>
        <a href="/privacy" style={styles.link}>{t("faq.privacy")}</a>
      </footer>
    </div>
  );
}

const styles = {
  // Needs a fixed height, not minHeight: index.css locks #root to
  // overflow:hidden, so a growing child is clipped instead of scrolling.
  page: {
    height: "100vh",
    background: "var(--bg, #0e0e10)",
    color: "var(--text, #efeff1)",
    overflowY: "auto",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 32px",
    borderBottom: "1px solid var(--border, #2a2a2e)",
  },
  brand: { display: "flex", alignItems: "center", gap: 10, textDecoration: "none" },
  brandIcon: { width: 28, height: 28, objectFit: "contain" },
  brandName: {
    fontFamily: "'Quicksand', system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 18,
    color: "var(--accent-light, #f0429b)",
    letterSpacing: "-0.01em",
  },
  headerRight: { display: "flex", alignItems: "center", gap: 10 },
  langSelect: { width: "auto", padding: "7px 10px", fontSize: 13 },
  headerBtn: {
    padding: "8px 16px",
    borderRadius: 9,
    textDecoration: "none",
    background: "var(--surface2, #1f1f23)",
    color: "var(--text, #efeff1)",
    border: "1px solid var(--border, #2a2a2e)",
    fontWeight: 600,
    fontSize: 13,
  },
  main: { maxWidth: 760, margin: "0 auto", padding: "48px 24px 24px" },
  title: { margin: 0, fontSize: 38, fontWeight: 800, letterSpacing: "-0.02em" },
  subtitle: {
    margin: "12px 0 0",
    fontSize: 16,
    lineHeight: 1.6,
    color: "var(--text-muted, #adadb8)",
  },
  list: { marginTop: 32, display: "flex", flexDirection: "column", gap: 12 },
  item: {
    borderRadius: 14,
    background: "var(--surface, #18181b)",
    border: "1px solid var(--border, #2a2a2e)",
    overflow: "hidden",
  },
  question: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "18px 20px",
    background: "transparent",
    border: "none",
    borderRadius: 0,
    cursor: "pointer",
    textAlign: "left",
    color: "var(--text, #efeff1)",
    fontSize: 15,
    fontWeight: 700,
  },
  questionText: { flex: 1 },
  answer: {
    margin: 0,
    padding: "0 20px 20px",
    fontSize: 15,
    lineHeight: 1.75,
    color: "var(--text-muted, #adadb8)",
  },
  privacyNote: { margin: "24px 0 0", fontSize: 14 },
  link: { color: "var(--accent-light, #f0429b)" },
  cta: {
    marginTop: 48,
    padding: "32px 24px",
    borderRadius: 14,
    textAlign: "center",
    background: "var(--surface, #18181b)",
    border: "1px solid var(--border, #2a2a2e)",
  },
  ctaTitle: { margin: 0, fontSize: 20, fontWeight: 700 },
  ctaBody: {
    margin: "10px 0 0",
    fontSize: 14,
    color: "var(--text-muted, #adadb8)",
  },
  ctaBtn: {
    display: "inline-block",
    marginTop: 20,
    padding: "13px 26px",
    borderRadius: 9,
    textDecoration: "none",
    background: "var(--accent, #e11d76)",
    color: "var(--on-accent, #ffffff)",
    fontWeight: 700,
    fontSize: 15,
  },
  footer: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    padding: "32px 24px 48px",
    fontSize: 13,
    color: "var(--text-muted, #adadb8)",
  },
};
