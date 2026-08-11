import React, { useState } from "react";
import {
  MessageCircle, Volume2, Mic, Image as ImageIcon, Trophy, SlidersHorizontal, PartyPopper,
} from "lucide-react";
import { apiUrl } from "./api.js";
import { detectLanguage, SUPPORTED_LANGUAGES, useTranslation } from "./i18n/index.js";
import logo from "./img/logo.png";

const FEATURE_ICONS = {
  chat: MessageCircle,
  tts: Volume2,
  voice: Mic,
  overlay: ImageIcon,
  leveling: Trophy,
  customize: SlidersHorizontal,
  events: PartyPopper,
};
const FEATURE_KEYS = ["chat", "tts", "voice", "overlay", "leveling", "customize", "events"];
const LANDING_LANG_KEY = "landingLang";

export default function Login() {
  const [lang, setLang] = useState(() => localStorage.getItem(LANDING_LANG_KEY) || detectLanguage());
  const { t } = useTranslation(lang);
  const [titleBefore, titleAfter] = t("login.title").split("{chat}");

  const handleLangChange = (e) => {
    const next = e.target.value;
    setLang(next);
    localStorage.setItem(LANDING_LANG_KEY, next);
  };

  return (
    <div style={styles.page}>
      <div style={styles.glow} />

      <header style={styles.header}>
        <div style={styles.brand}>
          {/* decorative: the brand name is already in the adjacent span */}
          <img src={logo} alt="" style={styles.brandIcon} />
          <span style={styles.brandName}>VTAmigo</span>
        </div>
        <div style={styles.headerRight}>
          <select style={styles.langSelect} value={lang} onChange={handleLangChange} aria-label="Language">
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
          <a style={styles.headerBtn} href={apiUrl("/auth/twitch/login")}>
            {t("login.logIn")}
          </a>
        </div>
      </header>

      <main style={styles.hero}>
        <h1 style={styles.title}>
          {titleBefore}
          <span style={styles.titleAccent}>{t("login.titleChat")}</span>
          {titleAfter}
        </h1>
        <p style={styles.subtitle}>{t("login.subtitle")}</p>
        <a style={styles.ctaBtn} href={apiUrl("/auth/twitch/login")}>
          {t("login.cta")}
        </a>
        <p style={styles.ctaNote}>{t("login.ctaNote")}</p>
      </main>

      <section style={styles.features}>
        {FEATURE_KEYS.map((key) => {
          const IconComp = FEATURE_ICONS[key];
          return (
            <div key={key} style={styles.card}>
              <div style={styles.cardIcon}><IconComp size={26} /></div>
              <h3 style={styles.cardTitle}>{t(`login.features.${key}.title`)}</h3>
              <p style={styles.cardDesc}>{t(`login.features.${key}.desc`)}</p>
            </div>
          );
        })}
      </section>

      <footer style={styles.footer}>
        <span>{t("login.footer")}</span>
        <div style={styles.footerLinks}>
          <a style={styles.footerLink} href="/faq">{t("login.faq")}</a>
          <span>·</span>
          <a style={styles.footerLink} href="/privacy">{t("login.privacy")}</a>
        </div>
      </footer>
    </div>
  );
}

const styles = {
  page: {
    position: "relative",
    height: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg, #0e0e10)",
    color: "var(--text, #efeff1)",
    overflowX: "hidden",
    overflowY: "auto",
  },
  glow: {
    position: "absolute",
    top: -200,
    left: "50%",
    transform: "translateX(-50%)",
    width: 900,
    height: 500,
    background: "radial-gradient(closest-side, rgba(225,29,118,0.25), transparent)",
    pointerEvents: "none",
  },
  header: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 32px",
  },
  brand: { display: "flex", alignItems: "center", gap: 10 },
  brandIcon: { width: 28, height: 28, objectFit: "contain" },
  brandName: {
    fontFamily: "'Quicksand', system-ui, sans-serif",
    fontWeight: 700,
    fontSize: 18,
    color: "var(--accent-light, #f0429b)",
    letterSpacing: "-0.01em",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  langSelect: {
    width: "auto",
    padding: "7px 10px",
    fontSize: 13,
  },
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
  hero: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    padding: "72px 24px 56px",
    maxWidth: 720,
    margin: "0 auto",
  },
  title: {
    margin: 0,
    fontSize: 44,
    fontWeight: 800,
    lineHeight: 1.15,
    letterSpacing: "-0.02em",
  },
  titleAccent: { color: "var(--accent-light, #f0429b)" },
  subtitle: {
    margin: "20px 0 0",
    fontSize: 17,
    lineHeight: 1.6,
    color: "var(--text-muted, #adadb8)",
    maxWidth: 560,
  },
  ctaBtn: {
    marginTop: 32,
    padding: "14px 28px",
    borderRadius: 9,
    textDecoration: "none",
    background: "var(--accent, #e11d76)",
    color: "var(--on-accent, #ffffff)",
    fontWeight: 700,
    fontSize: 16,
    boxShadow: "0 8px 24px rgba(225,29,118,0.35)",
  },
  ctaNote: {
    margin: "12px 0 0",
    fontSize: 13,
    color: "var(--text-muted, #adadb8)",
  },
  features: {
    position: "relative",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 20,
    padding: "0 32px 72px",
    maxWidth: 1000,
    margin: "0 auto",
    width: "100%",
  },
  card: {
    padding: "24px 20px",
    borderRadius: 14,
    background: "var(--surface, #18181b)",
    border: "1px solid var(--border, #2a2a2e)",
  },
  cardIcon: { fontSize: 26, marginBottom: 10 },
  cardTitle: { margin: "0 0 8px", fontSize: 15, fontWeight: 700 },
  cardDesc: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-muted, #adadb8)",
  },
  footer: {
    textAlign: "center",
    padding: "24px 24px 40px",
    fontSize: 12,
    color: "var(--text-muted, #adadb8)",
  },
  footerLinks: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  footerLink: { color: "var(--accent-light, #f0429b)" },
};
