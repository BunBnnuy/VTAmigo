import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "./api.js";
import logo from "./img/logo.png";

export default function Admin() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [users, setUsers] = useState(null);
  const [devices, setDevices] = useState(null);
  const [stats, setStats] = useState(null);
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // On mount, check for an existing (still-valid) admin session so a page
  // refresh doesn't force a re-login while the 4h-inactivity cookie is live.
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch("/admin/me");
        if (res.ok) setAuthed(true);
      } finally {
        setCheckingSession(false);
      }
    })();
  }, []);

  const loadUsers = useCallback(async () => {
    const res = await apiFetch("/admin/users");
    if (res.status === 401) { setAuthed(false); return; }
    const data = await res.json();
    setUsers(data.users);
  }, []);

  const loadDevices = useCallback(async () => {
    const res = await apiFetch("/admin/devices");
    if (res.status === 401) { setAuthed(false); return; }
    const data = await res.json();
    setDevices(data.devices);
  }, []);

  const loadStats = useCallback(async () => {
    const res = await apiFetch("/admin/stats");
    if (res.status === 401) { setAuthed(false); return; }
    if (!res.ok) return;
    const data = await res.json();
    setStats(data);
  }, []);

  const loadUsage = useCallback(async () => {
    const res = await apiFetch("/admin/usage");
    if (res.status === 401) { setAuthed(false); return; }
    if (!res.ok) return;
    const data = await res.json();
    setUsage(data.usage);
  }, []);

  useEffect(() => {
    if (authed) { loadUsers(); loadDevices(); loadUsage(); }
  }, [authed, loadUsers, loadDevices, loadUsage]);

  useEffect(() => {
    if (!authed) return;
    loadStats();
    const id = setInterval(loadStats, 30000);
    return () => clearInterval(id);
  }, [authed, loadStats]);

  useEffect(() => {
    if (!authed) return;
    const onScroll = () => setScrolled(window.scrollY > 140);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [authed]);

  const revokeDevice = async (deviceCode) => {
    await apiFetch(`/admin/devices/${deviceCode}/revoke`, { method: "POST" });
    loadDevices();
  };

  const userLabel = (twitchId) => users?.find((u) => u.twitchId === twitchId)?.displayName || twitchId || "—";

  const login = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await apiFetch("/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Login failed");
        return;
      }
      setAuthed(true);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await apiFetch("/admin/logout", { method: "POST" });
    setAuthed(false);
  };

  const setApproved = async (twitchId, approve) => {
    await apiFetch(`/admin/users/${twitchId}/${approve ? "approve" : "revoke"}`, { method: "POST" });
    loadUsers();
  };

  const setTier = async (twitchId, tier) => {
    await apiFetch(`/admin/users/${twitchId}/tier`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tier }),
    });
    loadUsers();
  };

  if (checkingSession) {
    return <div style={styles.wrap} />;
  }

  if (!authed) {
    return (
      <div style={styles.wrap}>
        <form style={styles.card} onSubmit={login}>
          <h1 style={styles.title}>Admin login</h1>
          <input
            style={styles.input}
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          {error && <div style={styles.error}>{error}</div>}
          <button style={styles.btn} type="submit" disabled={busy}>
            {busy ? "Checking…" : "Log in"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      {/* ── Top bar ── */}
      <div style={styles.topBar}>
        <div style={styles.brand}>
          <img src={logo} alt="VTAmigo" style={styles.brandIcon} />
          <span style={styles.brandName}>VTAmigo Admin</span>
          {scrolled && stats && (
            <span style={styles.miniStats}>
              CPU {stats.cpu.load}% · RAM {stats.mem.usedPercent}%
            </span>
          )}
        </div>
        <div style={styles.topRight}>
          <button style={styles.settingsBtn} onClick={logout}>Log out</button>
        </div>
      </div>

      <div style={styles.page}>
        <h1 style={styles.title}>System resources</h1>
        {!stats ? (
          <p>Loading…</p>
        ) : (
          <div style={{ marginBottom: 32, maxWidth: 720 }}>
            <div style={{ display: "flex", gap: 24, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={styles.meterLabel}>
                  <span>CPU</span><span>{stats.cpu.load}%</span>
                </div>
                <div style={styles.meterTrack}>
                  <div style={{ ...styles.meterFill, width: `${Math.min(100, stats.cpu.load)}%` }} />
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={styles.meterLabel}>
                  <span>RAM</span><span>{stats.mem.usedMB} / {stats.mem.totalMB} MB ({stats.mem.usedPercent}%)</span>
                </div>
                <div style={styles.meterTrack}>
                  <div style={{ ...styles.meterFill, width: `${Math.min(100, stats.mem.usedPercent)}%` }} />
                </div>
              </div>
            </div>
            <p style={{ opacity: 0.6, fontSize: 13, margin: "0 0 12px 0" }}>
              {stats.processCount} processes running · uptime {formatUptime(stats.uptimeSec)}
            </p>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>PID</th>
                  <th style={styles.th}>Process</th>
                  <th style={styles.th}>CPU</th>
                  <th style={styles.th}>RAM</th>
                </tr>
              </thead>
              <tbody>
                {stats.topProcesses.map((p) => (
                  <tr key={p.pid}>
                    <td style={styles.td}>{p.pid}</td>
                    <td style={styles.td}>{p.name}</td>
                    <td style={styles.td}>{p.cpu}%</td>
                    <td style={styles.td}>{p.memMB} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h1 style={styles.title}>User approvals</h1>
        <p style={{ opacity: 0.5, fontSize: 12, margin: "-8px 0 12px 0" }}>
          AI generation counts reset with the calendar (day/week/month). Token counts are estimated (~4 chars/token) —
          the CLI providers don't report exact usage.
        </p>
        {!users ? (
          <p>Loading…</p>
        ) : users.length === 0 ? (
          <p style={{ opacity: 0.7 }}>No users have logged in yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>User</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Tier</th>
                <th style={styles.th}>Since</th>
                <th style={styles.th}>Today</th>
                <th style={styles.th}>Week</th>
                <th style={styles.th}>Month</th>
                <th style={styles.th}>Tokens (mo.)</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const s = usage && usage[u.twitchId];
                return (
                  <tr key={u.twitchId}>
                    <td style={styles.td}>
                      <img src={u.profileImageUrl} alt="" style={styles.avatar} />
                      {u.displayName} <span style={{ opacity: 0.5 }}>({u.login})</span>
                    </td>
                    <td style={styles.td}>{u.approved ? "✅ Approved" : "⏳ Pending"}</td>
                    <td style={styles.td}>
                      <select
                        value={u.tier || "pro"}
                        onChange={(e) => setTier(u.twitchId, e.target.value)}
                        style={styles.tierSelect}
                      >
                        <option value="free">Free</option>
                        <option value="basic">Basic</option>
                        <option value="advanced">Advanced</option>
                        <option value="pro">Pro</option>
                      </select>
                    </td>
                    <td style={styles.td}>{new Date(u.createdAt).toLocaleString()}</td>
                    <td style={styles.td}>{s?.day ?? 0}</td>
                    <td style={styles.td}>{s?.week ?? 0}</td>
                    <td style={styles.td}>{s?.month ?? 0}</td>
                    <td style={styles.td}>{(s?.tokensMonth ?? 0).toLocaleString()}</td>
                    <td style={styles.td}>
                      {u.approved ? (
                        <button style={{ ...styles.smallBtn, background: "var(--red, #e91916)" }} onClick={() => setApproved(u.twitchId, false)}>
                          Revoke
                        </button>
                      ) : (
                        <button style={{ ...styles.smallBtn, background: "var(--purple, #9147ff)" }} onClick={() => setApproved(u.twitchId, true)}>
                          Approve
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <h1 style={{ ...styles.title, marginTop: 32 }}>Tunnel devices</h1>
        {!devices ? (
          <p>Loading…</p>
        ) : devices.length === 0 ? (
          <p style={{ opacity: 0.7 }}>No tunnel-client devices enrolled yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Approved by</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Port</th>
                <th style={styles.th}>Since</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.deviceCode}>
                  <td style={styles.td}>{d.twitchId ? userLabel(d.twitchId) : <span style={{ opacity: 0.5 }}>unclaimed</span>}</td>
                  <td style={styles.td}>
                    {d.status === "approved" ? "✅ Approved" : d.status === "revoked" ? "🚫 Revoked" : "⏳ Pending"}
                  </td>
                  <td style={styles.td}>{d.assignedPort || "—"}</td>
                  <td style={styles.td}>{new Date(d.createdAt).toLocaleString()}</td>
                  <td style={styles.td}>
                    {d.status === "approved" && (
                      <button style={{ ...styles.smallBtn, background: "var(--red, #e91916)" }} onClick={() => revokeDevice(d.deviceCode)}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const styles = {
  root: {
    minHeight: "100vh", background: "var(--bg, #0e0e10)", color: "var(--text, #efeff1)",
    display: "flex", flexDirection: "column",
  },
  wrap: {
    display: "flex", alignItems: "center", justifyContent: "center",
    height: "100vh", background: "var(--bg, #0e0e10)", color: "var(--text, #efeff1)",
  },
  card: {
    display: "flex", flexDirection: "column", gap: 12,
    padding: "40px 48px", borderRadius: 12, background: "var(--panel, #18181b)",
    border: "1px solid var(--border, #2a2a2e)", minWidth: 280,
  },
  topBar: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 16px", background: "var(--surface, #18181b)",
    borderBottom: "1px solid var(--border, #2a2a2e)", flexShrink: 0,
    position: "sticky", top: 0, zIndex: 10,
  },
  brand: { display: "flex", alignItems: "center", gap: 8 },
  brandIcon: { width: 24, height: 24, objectFit: "contain" },
  brandName: {
    fontWeight: 800, fontSize: 16, color: "var(--purple-light, #bf94ff)", letterSpacing: "-0.01em",
  },
  miniStats: {
    fontSize: 12, color: "var(--text-muted, #adadb8)", fontWeight: 400,
    marginLeft: 4, transition: "opacity 0.2s ease",
  },
  topRight: { display: "flex", gap: 8, alignItems: "center" },
  page: { padding: 32 },
  title: { margin: "0 0 12px 0", fontSize: 22 },
  input: { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border, #2a2a2e)", background: "#0e0e10", color: "#efeff1" },
  error: { color: "var(--red, #e91916)", fontSize: 13 },
  btn: { padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: "var(--purple, #9147ff)", color: "#fff", fontWeight: 600 },
  settingsBtn: {
    padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
    background: "var(--surface2, #202024)", color: "var(--text, #efeff1)", border: "1px solid var(--border, #2a2a2e)",
  },
  smallBtn: { padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", color: "#fff", fontWeight: 600, fontSize: 13 },
  tierSelect: {
    padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border, #2a2a2e)",
    background: "#0e0e10", color: "#efeff1", fontSize: 13,
  },
  table: { borderCollapse: "collapse", width: "100%", maxWidth: 820 },
  th: { textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border, #2a2a2e)", opacity: 0.7, fontSize: 13 },
  td: { padding: "8px 12px", borderBottom: "1px solid var(--border, #2a2a2e)", fontSize: 14, verticalAlign: "middle" },
  avatar: { width: 24, height: 24, borderRadius: "50%", verticalAlign: "middle", marginRight: 8 },
  meterLabel: { display: "flex", justifyContent: "space-between", fontSize: 13, opacity: 0.8, marginBottom: 4 },
  meterTrack: { height: 8, borderRadius: 4, background: "var(--border, #2a2a2e)", overflow: "hidden" },
  meterFill: { height: "100%", background: "var(--purple, #9147ff)", transition: "width 0.4s ease" },
};
