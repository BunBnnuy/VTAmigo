import React from "react";
import { apiUrl } from "./api.js";

export default function Login() {
  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <span style={styles.icon}>🎮</span>
        <h1 style={styles.title}>AI Companion</h1>
        <p style={styles.subtitle}>Log in with Twitch to continue.</p>
        <a style={styles.btn} href={apiUrl("/auth/twitch/login")}>
          Log in with Twitch
        </a>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    display: "flex", alignItems: "center", justifyContent: "center",
    height: "100vh", background: "var(--bg, #0e0e10)", color: "var(--text, #efeff1)",
  },
  card: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
    padding: "40px 48px", borderRadius: 12, background: "var(--panel, #18181b)",
    border: "1px solid var(--border, #2a2a2e)",
  },
  icon: { fontSize: 40 },
  title: { margin: 0, fontSize: 22 },
  subtitle: { margin: 0, opacity: 0.7, fontSize: 14 },
  btn: {
    marginTop: 12, padding: "10px 20px", borderRadius: 8, textDecoration: "none",
    background: "var(--purple, #9147ff)", color: "#fff", fontWeight: 600, fontSize: 14,
  },
};
