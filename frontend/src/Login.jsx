import React from "react";
import { apiUrl } from "./api.js";
import logo from "./img/logo.png";

const FEATURES = [
  {
    icon: "💬",
    title: "Reads your chat live",
    desc: "Batches messages from Twitch (and TikTok) and reacts with witty, in-context replies — not just repeating what chat said.",
  },
  {
    icon: "🗣️",
    title: "Talks back with TTS",
    desc: "Responses are spoken aloud instantly, so your co-host actually sounds like part of the stream.",
  },
  {
    icon: "🎭",
    title: "Syncs your avatar",
    desc: "Drives VTube Studio lip-sync while it talks, so your model reacts in real time.",
  },
  {
    icon: "🎉",
    title: "Reacts to events",
    desc: "Follows, subs, raids, and cheers all get an instant, on-brand reaction — no manual triggering needed.",
  },
];

export default function Login() {
  return (
    <div style={styles.page}>
      <div style={styles.glow} />

      <header style={styles.header}>
        <div style={styles.brand}>
          <img src={logo} alt="VTAmigo" style={styles.brandIcon} />
          <span style={styles.brandName}>VTAmigo</span>
        </div>
        <a style={styles.headerBtn} href={apiUrl("/auth/twitch/login")}>
          Log in with Twitch
        </a>
      </header>

      <main style={styles.hero}>
        <h1 style={styles.title}>
          An AI co-host that never misses <span style={styles.titleAccent}>chat</span>.
        </h1>
        <p style={styles.subtitle}>
          VTAmigo watches your Twitch chat, replies out loud, and animates your avatar —
          so your stream always has someone to talk to, even when it's quiet.
        </p>
        <a style={styles.ctaBtn} href={apiUrl("/auth/twitch/login")}>
          Log in with Twitch to get started
        </a>
        <p style={styles.ctaNote}>Free to try — no credit card required.</p>
      </main>

      <section style={styles.features}>
        {FEATURES.map((f) => (
          <div key={f.title} style={styles.card}>
            <div style={styles.cardIcon}>{f.icon}</div>
            <h3 style={styles.cardTitle}>{f.title}</h3>
            <p style={styles.cardDesc}>{f.desc}</p>
          </div>
        ))}
      </section>

      <footer style={styles.footer}>
        <span>VTAmigo works alongside your existing Twitch and VTube Studio setup.</span>
      </footer>
    </div>
  );
}

const styles = {
  page: {
    position: "relative",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg, #0e0e10)",
    color: "var(--text, #efeff1)",
    overflowX: "hidden",
  },
  glow: {
    position: "absolute",
    top: -200,
    left: "50%",
    transform: "translateX(-50%)",
    width: 900,
    height: 500,
    background: "radial-gradient(closest-side, rgba(145,71,255,0.25), transparent)",
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
    fontWeight: 800,
    fontSize: 18,
    color: "var(--purple-light, #bf94ff)",
    letterSpacing: "-0.01em",
  },
  headerBtn: {
    padding: "8px 16px",
    borderRadius: 8,
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
  titleAccent: { color: "var(--purple-light, #bf94ff)" },
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
    borderRadius: 10,
    textDecoration: "none",
    background: "var(--purple, #9147ff)",
    color: "#fff",
    fontWeight: 700,
    fontSize: 16,
    boxShadow: "0 8px 24px rgba(145,71,255,0.35)",
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
};
