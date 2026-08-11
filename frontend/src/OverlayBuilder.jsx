import React, { useState, useEffect, useCallback } from "react";
import Login from "./Login.jsx";
import Pending from "./Pending.jsx";
import OverlayCanvas from "./OverlayCanvas.jsx";
import { apiFetch, wsUrl } from "./api.js";
import logo from "./img/logo.png";
import { Clipboard, ArrowLeft } from "lucide-react";

// Kinds in backend/activity.js's KNOWN_KINDS, for the "Latest Activity"
// pre-fill modal (distinct from OverlayCanvas.jsx's TOKEN_TO_KIND namespaces
// — the backend route/table use "follow", the {token} syntax uses "follower").
const KIND_ORDER = ["follow", "sub", "resub", "giftsub", "raid", "cheer", "redeem"];
const KIND_LABELS = { follow: "Follower", sub: "Sub", resub: "Resub", giftsub: "Gift Sub", raid: "Raid", cheer: "Cheer", redeem: "Redeem" };

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
  // "create" | "rename" | null — which inline name prompt is open, if any.
  const [namePrompt, setNamePrompt] = useState(null);
  // Armed two-click delete (mirrors the rest of the app having no native
  // confirm() usage anywhere — see git history for why this replaced it).
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [toast, setToast] = useState("");
  const [showLatestActivity, setShowLatestActivity] = useState(false);
  // Account-wide (not per-layout), so it lives here rather than inside
  // OverlayCanvas — switching layouts shouldn't refetch it or reopen a new
  // WS connection just for this.
  const [latestByKind, setLatestByKind] = useState({});

  useEffect(() => {
    apiFetch("/overlay-builder/latest-activity")
      .then((r) => r.json())
      .then((data) => setLatestByKind(data.latestByKind || {}));
  }, []);

  // Live-updates {token} previews the moment a REAL Twitch event happens
  // (twitch_event, or a "chat" message with isRedeem) — deliberately real
  // data only, no test/simulated events, so what's shown always matches
  // what the actual OBS overlay would show. Mirrors backend/overlay/
  // custom.html's identical WS handling.
  useEffect(() => {
    const applyEvent = (event) => {
      if (!event?.kind) return;
      setLatestByKind((prev) => ({ ...prev, [event.kind]: event }));
    };
    const ws = new WebSocket(wsUrl("/chat"));
    ws.onmessage = (e) => {
      let data;
      try { data = JSON.parse(e.data); } catch { return; }
      if (data.type === "twitch_event") {
        applyEvent(data.event);
      } else if (data.type === "chat" && data.msg?.isRedeem) {
        applyEvent({ kind: "redeem", username: data.msg.username, rewardTitle: data.msg.rewardTitle, text: data.msg.text, timestamp: data.msg.timestamp });
      }
    };
    return () => ws.close();
  }, []);

  // Manually pre-fills {<ns>.username} for a kind Twitch's API has no
  // history for (sub/resub/giftsub/raid/cheer) — see activity.js. A real
  // live event of that kind always supersedes it automatically.
  const saveManualLatest = async (kind, username) => {
    const res = await apiFetch(`/overlay-builder/latest-activity/${kind}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (data.latestByKind) setLatestByKind(data.latestByKind);
  };

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

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  const submitName = async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return setNamePrompt(null);
    if (namePrompt === "create") {
      const res = await apiFetch("/overlay-builder/layouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const { layout } = await res.json();
      refreshLayouts(layout.id);
    } else if (namePrompt === "rename" && selectedId) {
      await apiFetch(`/overlay-builder/layouts/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      refreshLayouts(selectedId);
    }
    setNamePrompt(null);
  };

  const deleteLayout = async () => {
    if (!selectedId) return;
    if (!deleteArmed) { setDeleteArmed(true); return; }
    setDeleteArmed(false);
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
      setToast("OBS overlay URL copied to clipboard");
    } catch {
      setToast(url);
    }
  };

  const selectedLayout = layouts?.find((l) => l.id === selectedId) || null;

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
              onChange={(e) => { setSelectedId(e.target.value); setDeleteArmed(false); }}
            >
              {layouts.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          )}
          <button style={styles.btn} onClick={() => setNamePrompt("create")}>+ New Layout</button>
          {selectedId && <button style={styles.btn} onClick={() => setNamePrompt("rename")}>Rename</button>}
          {selectedId && (
            <button style={deleteArmed ? styles.dangerBtn : styles.btn} onClick={deleteLayout} onBlur={() => setDeleteArmed(false)}>
              {deleteArmed ? "Confirm delete?" : "Delete"}
            </button>
          )}
          {selectedId && <button style={styles.primaryBtn} onClick={copyOverlayUrl}>Copy OBS URL</button>}
          <button style={styles.btn} onClick={() => setShowLatestActivity(true)}><Clipboard size={14} color="var(--accent)" /> Latest Activity</button>
          <a style={styles.backLink} href="/"><ArrowLeft size={14} color="var(--accent)" /> Back to app</a>
        </div>
      </div>

      {toast && <div style={styles.toast}>{toast}</div>}

      {namePrompt && (
        <NamePrompt
          title={namePrompt === "create" ? "New layout name" : "Rename layout"}
          initialValue={namePrompt === "rename" ? (selectedLayout?.name || "") : ""}
          onSubmit={submitName}
          onCancel={() => setNamePrompt(null)}
        />
      )}

      {showLatestActivity && (
        <LatestActivityModal
          latestByKind={latestByKind}
          onSave={saveManualLatest}
          onClose={() => setShowLatestActivity(false)}
        />
      )}

      <div style={styles.body}>
        {layouts === null ? (
          <div style={styles.empty}>Loading…</div>
        ) : layouts.length === 0 ? (
          <div style={styles.empty}>
            <p>No layouts yet.</p>
            <button style={styles.primaryBtn} onClick={() => setNamePrompt("create")}>+ Create your first layout</button>
          </div>
        ) : selectedId ? (
          <OverlayCanvas key={selectedId} layoutId={selectedId} latestByKind={latestByKind} />
        ) : (
          <div style={styles.empty}>Select a layout above.</div>
        )}
      </div>
    </div>
  );
}

function NamePrompt({ title, initialValue, onSubmit, onCancel }) {
  const [value, setValue] = useState(initialValue);

  return (
    <div style={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form
        style={styles.modalCard}
        onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}
      >
        <div style={styles.panelTitle}>{title}</div>
        <input
          autoFocus
          style={styles.select}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={80}
        />
        <div style={styles.panelActions}>
          <button type="button" style={styles.btn} onClick={onCancel}>Cancel</button>
          <button type="submit" style={styles.primaryBtn}>Save</button>
        </div>
      </form>
    </div>
  );
}

// Twitch has no historical API at all for sub/resub/giftsub/raid/cheer (only
// follows and redemptions can be backfilled), so those {token}s would
// otherwise sit unfilled until the first real one happens live. This lets
// the streamer type in a name to pre-fill it — disabled once real ("live")
// data exists for that kind, since a real event always wins over a manual
// one and editing further would have no visible effect.
function LatestActivityModal({ latestByKind, onSave, onClose }) {
  return (
    <div style={styles.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={styles.modalCard}>
        <div style={styles.panelTitle}>Latest Activity</div>
        <div style={styles.panelHint}>
          Twitch has no history for sub/resub/gift sub/raid/cheer — pre-fill a name here until a real one happens live. Follower/redeem come from Twitch automatically.
        </div>
        {KIND_ORDER.map((kind) => (
          <LatestActivityRow key={kind} kind={kind} entry={latestByKind[kind]} onSave={onSave} />
        ))}
        <div style={styles.panelActions}>
          <button type="button" style={styles.primaryBtn} onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function LatestActivityRow({ kind, entry, onSave }) {
  const [value, setValue] = useState(entry?.username || "");
  useEffect(() => { setValue(entry?.username || ""); }, [entry?.username]);
  const isLive = !!entry && !entry.manual;

  return (
    <label style={styles.label}>
      {KIND_LABELS[kind]} {isLive && <span style={styles.liveBadge}>live</span>}
      <input
        style={styles.select}
        value={value}
        placeholder="—"
        disabled={isLive}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => !isLive && onSave(kind, value)}
      />
    </label>
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
    color: "var(--accent-light)",
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
    background: "var(--accent)",
    color: "var(--on-accent)",
    border: "none",
  },
  dangerBtn: {
    background: "var(--red)",
    color: "#fff",
    border: "none",
  },
  backLink: {
    color: "var(--text-muted)",
    fontSize: 13,
    textDecoration: "none",
    marginLeft: 8,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  toast: {
    position: "fixed",
    top: 56,
    right: 16,
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "8px 12px",
    fontSize: 13,
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
    zIndex: 50,
    maxWidth: 400,
    wordBreak: "break-all",
  },
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modalCard: {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minWidth: 280,
    maxWidth: 360,
    maxHeight: "80vh",
    overflowY: "auto",
  },
  panelTitle: {
    fontWeight: 700,
    fontSize: 13,
    color: "var(--accent-light)",
  },
  panelActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  },
  panelHint: {
    fontSize: 11,
    color: "var(--text-muted)",
    lineHeight: 1.4,
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 12,
    color: "var(--text-muted)",
  },
  liveBadge: {
    fontSize: 9,
    fontWeight: 700,
    color: "var(--green)",
    border: "1px solid var(--green)",
    borderRadius: 3,
    padding: "0 4px",
    marginLeft: 4,
    textTransform: "uppercase",
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
