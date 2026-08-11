import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "./api.js";
import logo from "./img/logo.png";

export default function Admin() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [users, setUsers] = useState(null);
  const [stats, setStats] = useState(null);
  const [usage, setUsage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [siteConfig, setSiteConfig] = useState(null);
  const [savingProvider, setSavingProvider] = useState(false);
  const [errorLog, setErrorLog] = useState(null);

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

  const loadSiteConfig = useCallback(async () => {
    const res = await apiFetch("/admin/site-config");
    if (res.status === 401) { setAuthed(false); return; }
    if (!res.ok) return;
    const data = await res.json();
    setSiteConfig(data);
  }, []);

  const loadErrorLog = useCallback(async () => {
    const res = await apiFetch("/admin/error-log");
    if (res.status === 401) { setAuthed(false); return; }
    if (!res.ok) return;
    const data = await res.json();
    setErrorLog(data.entries);
  }, []);

  useEffect(() => {
    if (authed) { loadUsers(); loadUsage(); loadSiteConfig(); loadErrorLog(); }
  }, [authed, loadUsers, loadUsage, loadSiteConfig, loadErrorLog]);

  useEffect(() => {
    if (!authed) return;
    loadStats();
    const id = setInterval(loadStats, 30000);
    return () => clearInterval(id);
  }, [authed, loadStats]);

  const clearErrorLog = async () => {
    await apiFetch("/admin/error-log", { method: "DELETE" });
    loadErrorLog();
  };

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

  const setAiProvider = async (aiProvider) => {
    setSavingProvider(true);
    try {
      const res = await apiFetch("/admin/site-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiProvider }),
      });
      if (res.ok) {
        const data = await res.json();
        setSiteConfig(data);
      }
    } finally {
      setSavingProvider(false);
    }
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

  const approvedUsers = users?.filter((u) => u.approved).length ?? 0;
  const pendingUsers = users ? users.length - approvedUsers : 0;

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div style={styles.root}>
      {/* ── Sidebar ── */}
      <div style={styles.sidebar}>
        <div style={styles.brand}>
          <img src={logo} alt="VTAmigo" style={styles.brandIcon} />
          <span style={styles.brandName}>VTAmigo</span>
        </div>
        <nav style={styles.nav}>
          <button className="admin-nav-link" onClick={() => scrollTo("sec-system")}><span className="dot" />System</button>
          <button className="admin-nav-link" onClick={() => scrollTo("sec-agent")}><span className="dot" />AI agent</button>
          <button className="admin-nav-link" onClick={() => scrollTo("sec-users")}><span className="dot" />Users</button>
          <button className="admin-nav-link" onClick={() => scrollTo("sec-errors")}><span className="dot" />Errors</button>
        </nav>
        <button style={styles.logoutBtn} onClick={logout}>Log out</button>
      </div>

      {/* ── Main ── */}
      <div style={styles.main}>
        <div style={styles.topBar}>
          <span style={styles.topBarTitle}>Dashboard</span>
          {stats && (
            <span style={styles.miniStats}>CPU {stats.cpu.load}% · RAM {stats.mem.usedPercent}%</span>
          )}
        </div>

        <div style={styles.page}>
          {/* Stat cards */}
          <div style={styles.statGrid}>
            <div style={styles.statCard}>
              <span style={styles.statLabel}>CPU load</span>
              <span style={styles.statValue}>{stats ? `${stats.cpu.load}%` : "—"}</span>
            </div>
            <div style={styles.statCard}>
              <span style={styles.statLabel}>Memory</span>
              <span style={styles.statValue}>{stats ? `${stats.mem.usedPercent}%` : "—"}</span>
            </div>
            <div style={styles.statCard}>
              <span style={styles.statLabel}>Users</span>
              <span style={styles.statValue}>{users ? users.length : "—"}</span>
              {users && <span style={styles.statSub}>{approvedUsers} approved · {pendingUsers} pending</span>}
            </div>
            <div style={styles.statCard}>
              <span style={styles.statLabel}>Uptime</span>
              <span style={styles.statValue}>{stats ? formatUptime(stats.uptimeSec) : "—"}</span>
            </div>
          </div>

          {/* System resources */}
          <section id="sec-system" style={styles.card}>
            <h2 style={styles.cardTitle}>System resources</h2>
            {!stats ? (
              <p style={styles.muted}>Loading…</p>
            ) : (
              <>
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
                <p style={styles.muted}>
                  {stats.processCount} processes running · uptime {formatUptime(stats.uptimeSec)}
                </p>
                <div style={styles.tableWrap}>
                  <table className="admin-table" style={styles.table}>
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
              </>
            )}
          </section>

          {/* AI agent */}
          <section id="sec-agent" style={styles.card}>
            <h2 style={styles.cardTitle}>AI agent</h2>
            <p style={styles.muted}>
              Controls which AI answers chat/events for everyone on the site. A user's own model
              preference in Settings is ignored — this is the only switch that matters.
            </p>
            {!siteConfig ? (
              <p style={styles.muted}>Loading…</p>
            ) : (
              <select
                value={siteConfig.aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
                disabled={savingProvider}
                style={{ ...styles.tierSelect, fontSize: 14, padding: "8px 12px", maxWidth: 220 }}
              >
                <option value="claude">Claude</option>
                <option value="grok">Grok</option>
              </select>
            )}
          </section>

          {/* User approvals */}
          <section id="sec-users" style={styles.card}>
            <h2 style={styles.cardTitle}>User approvals</h2>
            <p style={styles.muted}>
              AI generation counts reset with the calendar (day/week/month). Token counts are estimated (~4 chars/token) —
              the CLI providers don't report exact usage.
            </p>
            {!users ? (
              <p style={styles.muted}>Loading…</p>
            ) : users.length === 0 ? (
              <p style={styles.muted}>No users have logged in yet.</p>
            ) : (
              <div style={styles.tableWrap}>
                <table className="admin-table" style={styles.table}>
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
                            <span style={{ display: "inline-flex", alignItems: "center" }}>
                              <img src={u.profileImageUrl} alt="" style={styles.avatar} />
                              {u.displayName} <span style={{ opacity: 0.5, marginLeft: 4 }}>({u.login})</span>
                            </span>
                          </td>
                          <td style={styles.td}>
                            {u.approved
                              ? <span style={styles.badgeGreen}>Approved</span>
                              : <span style={styles.badgeYellow}>Pending</span>}
                          </td>
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
                              <button style={{ ...styles.smallBtn, background: "var(--purple, #ffde4d)", color: "var(--on-accent, #2e3256)" }} onClick={() => setApproved(u.twitchId, true)}>
                                Approve
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Frontend error log */}
          <section id="sec-errors" style={{ ...styles.card, marginBottom: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <h2 style={styles.cardTitle}>Errors</h2>
              {errorLog && errorLog.length > 0 && (
                <button style={{ ...styles.smallBtn, background: "var(--red, #e91916)" }} onClick={clearErrorLog}>
                  Clear
                </button>
              )}
            </div>
            <p style={styles.muted}>
              Errors reported from users' browsers — uncaught exceptions, unhandled promise rejections, and React
              render crashes across the main site.
            </p>
            {!errorLog ? (
              <p style={styles.muted}>Loading…</p>
            ) : errorLog.length === 0 ? (
              <p style={styles.muted}>No errors reported.</p>
            ) : (
              <div style={styles.tableWrap}>
                <table className="admin-table" style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>When</th>
                      <th style={styles.th}>User</th>
                      <th style={styles.th}>Source</th>
                      <th style={styles.th}>Message</th>
                      <th style={styles.th}>URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...errorLog].reverse().map((e) => (
                      <tr key={e.id}>
                        <td style={styles.td}>{new Date(e.timestamp).toLocaleString()}</td>
                        <td style={styles.td}>{e.twitchLogin || <span style={{ opacity: 0.5 }}>—</span>}</td>
                        <td style={styles.td}>{e.source || <span style={{ opacity: 0.5 }}>—</span>}</td>
                        <td style={{ ...styles.td, whiteSpace: "normal", maxWidth: 420 }} title={e.stack || ""}>{e.message}</td>
                        <td style={{ ...styles.td, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{e.url || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
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
    // height (not minHeight) + overflow hidden so this becomes the fixed
    // viewport-sized shell — matches index.css's html/body/#root overflow:
    // hidden rule (needed so the Overlay Studio's own canvas doesn't scroll
    // the page). Admin's actual scrolling happens in `page` below; without
    // a bounded height here there's nothing for the wheel to scroll — this
    // page's content just got silently clipped by #root's overflow: hidden.
    height: "100vh", overflow: "hidden", background: "var(--bg, #171826)", color: "var(--text, #edeef7)",
    display: "flex",
  },
  wrap: {
    display: "flex", alignItems: "center", justifyContent: "center",
    height: "100vh", background: "var(--bg, #171826)", color: "var(--text, #edeef7)",
  },
  card: {
    display: "flex", flexDirection: "column", gap: 12,
    padding: "40px 48px", borderRadius: 12, background: "var(--surface, #1f2033)",
    border: "1px solid var(--border, #393d60)", minWidth: 280,
  },

  /* Sidebar */
  sidebar: {
    width: 220, flexShrink: 0, minHeight: "100vh",
    background: "var(--surface, #1f2033)", borderRight: "1px solid var(--border, #393d60)",
    display: "flex", flexDirection: "column", padding: "20px 14px",
    position: "sticky", top: 0, alignSelf: "flex-start",
  },
  brand: { display: "flex", alignItems: "center", gap: 8, padding: "0 6px", marginBottom: 24 },
  brandIcon: { width: 26, height: 26, objectFit: "contain" },
  brandName: {
    fontWeight: 800, fontSize: 16, color: "var(--purple-light, #ffec99)", letterSpacing: "-0.01em",
  },
  nav: { display: "flex", flexDirection: "column", gap: 2, flex: 1 },
  logoutBtn: {
    padding: "9px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 13,
    background: "var(--surface2, #2a2d46)", color: "var(--text, #edeef7)", border: "1px solid var(--border, #393d60)",
  },

  /* Main */
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" },
  topBar: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
    padding: "16px 32px", borderBottom: "1px solid var(--border, #393d60)",
    flexShrink: 0, zIndex: 10, background: "var(--bg, #171826)",
  },
  topBarTitle: { fontWeight: 700, fontSize: 18 },
  miniStats: { fontSize: 12, color: "var(--text-muted, #9599c6)", fontWeight: 500 },
  // The actual scroll region — `main` is capped to the viewport (overflow
  // hidden), so this is what the mouse wheel scrolls.
  page: { padding: "24px 32px 48px", flex: 1, overflowY: "auto" },

  /* Stat cards */
  statGrid: {
    display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 14, marginBottom: 24,
  },
  statCard: {
    display: "flex", flexDirection: "column", gap: 4,
    padding: "16px 18px", borderRadius: 12, background: "var(--surface, #1f2033)",
    border: "1px solid var(--border, #393d60)",
  },
  statLabel: { fontSize: 12, color: "var(--text-muted, #9599c6)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em" },
  statValue: { fontSize: 26, fontWeight: 800 },
  statSub: { fontSize: 12, color: "var(--text-muted, #9599c6)" },

  /* Section cards */
  cardTitle: { margin: "0 0 12px 0", fontSize: 17, fontWeight: 700 },
  muted: { color: "var(--text-muted, #9599c6)", fontSize: 13, marginBottom: 12 },

  title: { margin: "0 0 4px 0", fontSize: 22 },
  input: { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border, #393d60)", background: "var(--bg, #171826)", color: "var(--text, #edeef7)" },
  error: { color: "var(--red, #e91916)", fontSize: 13 },
  btn: { padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer", background: "var(--purple, #ffde4d)", color: "var(--on-accent, #2e3256)", fontWeight: 600 },
  smallBtn: { padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", color: "#fff", fontWeight: 600, fontSize: 13 },
  tierSelect: {
    padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border, #393d60)",
    background: "var(--bg, #171826)", color: "var(--text, #edeef7)", fontSize: 13,
  },

  tableWrap: { overflowX: "auto", borderRadius: 10, border: "1px solid var(--border, #393d60)" },
  table: { borderCollapse: "collapse", width: "100%" },
  th: { textAlign: "left", padding: "10px 14px", borderBottom: "1px solid var(--border, #393d60)", color: "var(--text-muted, #9599c6)", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.03em", whiteSpace: "nowrap" },
  td: { padding: "10px 14px", borderBottom: "1px solid var(--border, #393d60)", fontSize: 14, verticalAlign: "middle", whiteSpace: "nowrap" },
  avatar: { width: 24, height: 24, borderRadius: "50%", verticalAlign: "middle", marginRight: 8 },

  badgeGreen: {
    display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
    background: "color-mix(in srgb, var(--green, #00b300) 18%, transparent)", color: "var(--green, #00b300)",
  },
  badgeYellow: {
    display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
    background: "color-mix(in srgb, var(--yellow, #ffb31a) 18%, transparent)", color: "var(--yellow, #ffb31a)",
  },
  badgeRed: {
    display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
    background: "color-mix(in srgb, var(--red, #e91916) 18%, transparent)", color: "var(--red, #e91916)",
  },

  meterLabel: { display: "flex", justifyContent: "space-between", fontSize: 13, opacity: 0.8, marginBottom: 4 },
  meterTrack: { height: 8, borderRadius: 4, background: "var(--border, #393d60)", overflow: "hidden" },
  meterFill: { height: "100%", background: "var(--purple, #ffde4d)", transition: "width 0.4s ease" },
};
