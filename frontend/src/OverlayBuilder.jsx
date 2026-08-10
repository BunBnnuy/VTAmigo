import React, { useState, useEffect, useCallback } from "react";
import Login from "./Login.jsx";
import Pending from "./Pending.jsx";
import OverlayCanvas from "./OverlayCanvas.jsx";
import { apiFetch } from "./api.js";
import logo from "./img/logo.png";

// Standalone page (mounted at /overlay-builder — see main.jsx) for designing
// a fully custom OBS overlay: transparent 1920x1080 canvas, image/text/video
// layers, saved as one or more named layouts. Gated behind the same
// Twitch-login + approval check as the main app (App.jsx:89-129) — this is a
// separate React root/bundle branch, not a panel inside the main app, so it
// re-does that same auth-gate rather than sharing AppInner's state.
export default function OverlayBuilder() {
  const [authState, setAuthState] = useState(null);

  const checkAuth = useCallback(() => {
    apiFetch("/auth/me")
      .then((r) => r.json())
      .then(setAuthState)
      .catch(() => setAuthState({ loggedIn: false }));
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  if (!authState) return null;
  if (!authState.loggedIn) return <Login />;
  if (!authState.approved) return <Pending displayName={authState.displayName} onLoggedOut={checkAuth} />;
  return <BuilderInner />;
}

function BuilderInner() {
  const [layouts, setLayouts] = useState(null); // null = loading
  const [selectedId, setSelectedId] = useState(null);

  const refreshLayouts = useCallback((selectAfter) => {
    apiFetch("/overlay-builder/layouts")
      .then((r) => r.json())
      .then((data) => {
        setLayouts(data.layouts);
        if (selectAfter) setSelectedId(selectAfter);
        else if (!selectedId && data.layouts.length) setSelectedId(data.layouts[0].id);
      })
      .catch(() => setLayouts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { refreshLayouts(); }, [refreshLayouts]);

  const createLayout = async () => {
    const name = window.prompt("Layout name?", "New Layout");
    if (!name) return;
    const res = await apiFetch("/overlay-builder/layouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const { layout } = await res.json();
    refreshLayouts(layout.id);
  };

  const renameLayout = async () => {
    if (!selectedId) return;
    const current = layouts.find((l) => l.id === selectedId);
    const name = window.prompt("Rename layout", current?.name || "");
    if (!name) return;
    await apiFetch(`/overlay-builder/layouts/${selectedId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    refreshLayouts(selectedId);
  };

  const deleteLayout = async () => {
    if (!selectedId) return;
    if (!window.confirm("Delete this layout? This can't be undone.")) return;
    await apiFetch(`/overlay-builder/layouts/${selectedId}`, { method: "DELETE" });
    setSelectedId(null);
    refreshLayouts();
  };

  const copyOverlayUrl = async () => {
    if (!selectedId) return;
    const res = await apiFetch(`/overlay-builder/overlay-url/${selectedId}`);
    const { url } = await res.json();
    try {
      await navigator.clipboard.writeText(url);
      window.alert("OBS overlay URL copied to clipboard:\n\n" + url);
    } catch {
      window.prompt("Copy this OBS overlay URL:", url);
    }
  };

  return (
    <div style={styles.root}>
      <div style={styles.topBar}>
        <div style={styles.brand}>
          <img src={logo} alt="VTAmigo" style={styles.brandIcon} />
          <span style={styles.brandName}>Overlay Studio</span>
        </div>
        <div style={styles.topRight}>
          {layouts && layouts.length > 0 && (
            <select
              style={styles.select}
              value={selectedId || ""}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )}
          <button style={styles.btn} onClick={createLayout}>+ New Layout</button>
          {selectedId && <button style={styles.btn} onClick={renameLayout}>Rename</button>}
          {selectedId && <button style={styles.btn} onClick={deleteLayout}>Delete</button>}
          {selectedId && <button style={styles.primaryBtn} onClick={copyOverlayUrl}>Copy OBS URL</button>}
          <a style={styles.backLink} href="/">← Back to app</a>
        </div>
      </div>

      <div style={styles.body}>
        {layouts === null ? (
          <div style={styles.empty}>Loading…</div>
        ) : layouts.length === 0 ? (
          <div style={styles.empty}>
            <p>No layouts yet.</p>
            <button style={styles.primaryBtn} onClick={createLayout}>+ Create your first layout</button>
          </div>
        ) : selectedId ? (
          <OverlayCanvas key={selectedId} layoutId={selectedId} />
        ) : (
          <div style={styles.empty}>Select a layout above.</div>
        )}
      </div>
    </div>
  );
}

const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
    background: "var(--bg)",
    color: "var(--text)",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    background: "var(--surface)",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
    gap: 12,
    flexWrap: "wrap",
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  brandIcon: { width: 24, height: 24, objectFit: "contain" },
  brandName: {
    fontWeight: 800,
    fontSize: 16,
    color: "var(--purple-light)",
    letterSpacing: "-0.01em",
  },
  topRight: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  select: {
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "6px 8px",
  },
  btn: {
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
  primaryBtn: {
    background: "var(--purple)",
    color: "#fff",
    border: "none",
  },
  backLink: {
    color: "var(--text-muted)",
    fontSize: 13,
    textDecoration: "none",
    marginLeft: 8,
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    height: "100%",
    color: "var(--text-muted)",
  },
};
