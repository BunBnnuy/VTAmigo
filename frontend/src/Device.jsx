import React, { useState, useEffect, useCallback } from "react";
import Login from "./Login.jsx";
import Pending from "./Pending.jsx";
import { apiFetch } from "./api.js";

// Shown at /device?code=XXXXXX — approves a tunnel-client device enrollment.
// Requires the approver to already be a logged-in, approved Twitch user
// (same gate as the main app), so anyone who can run this page can vouch
// for a device without a separate admin step.
export default function Device() {
  const [authState, setAuthState] = useState(null);
  const [userCode, setUserCode] = useState(() => new URLSearchParams(window.location.search).get("code") || "");

  const checkAuth = useCallback(() => {
    apiFetch("/auth/me").then((r) => r.json()).then(setAuthState).catch(() => setAuthState({ loggedIn: false }));
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  if (!authState) return null;
  if (!authState.loggedIn) return <Login />;
  if (!authState.approved) return <Pending displayName={authState.displayName} onLoggedOut={checkAuth} />;

  return <ApproveDevice userCode={userCode} setUserCode={setUserCode} />;
}

function ApproveDevice({ userCode, setUserCode }) {
  const [status, setStatus] = useState("idle"); // idle | checking | ready | approving | done | error
  const [error, setError] = useState("");
  const [lookup, setLookup] = useState(null);

  const check = useCallback(async (code) => {
    if (!code || code.length < 4) return;
    setStatus("checking");
    setError("");
    try {
      const res = await apiFetch(`/device/lookup?userCode=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Code not found or expired");
        setStatus("error");
        return;
      }
      setLookup(data);
      setStatus(data.status === "approved" ? "done" : "ready");
    } catch {
      setError("Network error");
      setStatus("error");
    }
  }, []);

  useEffect(() => { check(userCode); }, [userCode, check]);

  const approve = async () => {
    setStatus("approving");
    setError("");
    try {
      const res = await apiFetch("/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Approval failed");
        setStatus("error");
        return;
      }
      setStatus("done");
    } catch {
      setError("Network error");
      setStatus("error");
    }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <h1 style={styles.title}>Approve tunnel client</h1>

        <div style={styles.field}>
          <label>Device code</label>
          <input
            style={styles.input}
            value={userCode}
            onChange={(e) => setUserCode(e.target.value.toUpperCase())}
            placeholder="e.g. A1B2C3"
            maxLength={6}
            autoFocus={!userCode}
          />
          <span style={styles.hint}>Shown by the tunnel-client.exe window on the device you're approving.</span>
        </div>

        {status === "checking" && <p>Checking code…</p>}
        {status === "error" && <p style={styles.error}>{error}</p>}
        {status === "ready" && (
          <>
            <p>This will let that device open a VTube Studio lip-sync tunnel through this server.</p>
            <button style={styles.btn} onClick={approve}>Approve this device</button>
          </>
        )}
        {status === "approving" && <p>Approving…</p>}
        {status === "done" && <p style={styles.success}>✅ Device approved — it should connect automatically within a few seconds.</p>}
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
    display: "flex", flexDirection: "column", gap: 12,
    padding: "40px 48px", borderRadius: 12, background: "var(--surface, #18181b)",
    border: "1px solid var(--border, #2a2a2e)", minWidth: 320, maxWidth: 420,
  },
  title: { margin: "0 0 4px 0", fontSize: 22 },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  input: {
    padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border, #2a2a2e)",
    background: "var(--bg, #0e0e10)", color: "var(--text, #efeff1)", fontSize: 18, letterSpacing: 2, textAlign: "center",
  },
  hint: { fontSize: 12, opacity: 0.6 },
  btn: { padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: "var(--accent, #e11d76)", color: "var(--on-accent, #ffffff)", fontWeight: 600 },
  error: { color: "var(--red, #ef4444)", fontSize: 13 },
  success: { color: "#3fb950", fontSize: 14 },
};
