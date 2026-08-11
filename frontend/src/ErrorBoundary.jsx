import React from "react";
import { logError } from "./errorLogger.js";

export default class ErrorBoundary extends React.Component {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  componentDidCatch(error, info) {
    logError("react.render", error, { componentStack: info?.componentStack?.slice(0, 2000) });
  }

  render() {
    if (this.state.crashed) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          flexDirection: "column", gap: 12, background: "var(--bg, #171826)", color: "var(--text, #edeef7)", padding: 24, textAlign: "center",
        }}>
          <h2 style={{ margin: 0 }}>Something went wrong</h2>
          <p style={{ opacity: 0.7, maxWidth: 420 }}>The app hit an unexpected error. Try reloading the page.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: "var(--purple, #ffde4d)", color: "var(--on-accent, #2e3256)", fontWeight: 600 }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
