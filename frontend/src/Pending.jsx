import React from "react";
import { apiFetch } from "./api.js";

export default function Pending({ displayName, onLoggedOut }) {
  const logout = async () => {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    onLoggedOut();
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <span style={styles.icon}>⏳</span>
        <h1 style={styles.title}>Awaiting approval</h1>
        <p style={styles.subtitle}>
          Hey {displayName}, your account is waiting for an admin to approve access.
        </p>
        <button style={styles.btn} onClick={logout}>Log out</button>
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
    padding: "40px 48px", borderRadius: 12, background: "var(--surface, #18181b)",
    border: "1px solid var(--border, #2a2a2e)", maxWidth: 360, textAlign: "center",
  },
  icon: { fontSize: 40 },
  title: { margin: 0, fontSize: 22 },
  subtitle: { margin: 0, opacity: 0.7, fontSize: 14 },
  btn: {
    marginTop: 12, padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer",
    background: "var(--red, #ef4444)", color: "#fff", fontWeight: 600, fontSize: 14,
  },
};
