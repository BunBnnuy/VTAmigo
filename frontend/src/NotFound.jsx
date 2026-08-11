import React from "react";
import angryKb from "./img/KB Emo_Type Angry_2026-08-11-12-40-30.gif";

export default function NotFound() {
  return (
    <div style={styles.page}>
      <img src={angryKb} alt="VTAmigo's mascot, looking annoyed" style={styles.art} />
      <h1 style={styles.code}>404</h1>
      <p style={styles.title}>This page doesn't exist — and now she's mad about it.</p>
      <p style={styles.subtitle}>Whatever you were looking for isn't here.</p>
      <a style={styles.homeBtn} href="/">Back to VTAmigo</a>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "48px 24px",
    background: "var(--bg, #0e0e10)",
    color: "var(--text, #efeff1)",
    overflowY: "auto",
  },
  art: {
    width: 220,
    height: "auto",
    marginBottom: 8,
  },
  code: {
    margin: 0,
    fontSize: 56,
    fontWeight: 800,
    letterSpacing: "-0.02em",
    color: "var(--accent, #e11d76)",
  },
  title: {
    margin: "8px 0 0",
    fontSize: 18,
    fontWeight: 700,
    maxWidth: 440,
  },
  subtitle: {
    margin: "8px 0 0",
    fontSize: 14,
    color: "var(--text-muted, #adadb8)",
  },
  homeBtn: {
    marginTop: 28,
    padding: "12px 24px",
    borderRadius: 9,
    textDecoration: "none",
    background: "var(--accent, #e11d76)",
    color: "var(--on-accent, #ffffff)",
    fontWeight: 700,
    fontSize: 14,
  },
};
