import React, { useState, useEffect, useRef, useCallback } from "react";
import { Check, Link2, MessageCircle, Gift, PartyPopper, Type, RotateCcw } from "lucide-react";
import { apiFetch } from "./api.js";
import { useTranslation } from "./i18n/index.js";

// The chat overlay's entire option set is described by the backend schema
// (backend/chatOverlaySchema.js), served from GET /chat-overlay/schema. This
// panel renders that schema directly, so an option added on the backend shows
// up here with no frontend change — and the form can never validate
// differently from the server.

// Open by default; every other group starts collapsed so the panel is usable
// despite there being a group per role and per event type.
const OPEN_GROUPS = new Set(["Layout", "Messages"]);

const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const COMMON_FONTS = [
  "Segoe UI", "Arial", "Verdana", "Tahoma", "Trebuchet MS", "Georgia",
  "Times New Roman", "Courier New", "Comic Sans MS", "Impact", "Calibri",
];

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{ ...styles.toggle, background: checked ? "var(--accent)" : "var(--border)" }}
    >
      <span style={{ ...styles.toggleKnob, background: checked ? "var(--on-accent)" : "#fff", transform: checked ? "translateX(16px)" : "translateX(0)" }} />
    </button>
  );
}

// Color inputs can't represent "unset" — role background/border overrides use
// "" to mean "inherit the global Name/Message box value", so they get an
// explicit clear affordance.
function ColorField({ value, onChange }) {
  const isSet = value !== "";
  return (
    <div style={styles.colorRow}>
      <input
        type="color"
        value={isSet ? value : "#888888"}
        onChange={(e) => onChange(e.target.value)}
        style={styles.colorInput}
      />
      {isSet ? (
        <button type="button" style={styles.clearBtn} onClick={() => onChange("")} title="Use global default">
          <RotateCcw size={12} color="var(--accent)" />
        </button>
      ) : (
        <span style={styles.inherit}>global</span>
      )}
    </div>
  );
}

// Content only — outer window chrome (drag/resize/collapse) is provided by
// WindowManager.jsx's shared <Window>.
export default function ChatOverlayPanel({ lang }) {
  const { t } = useTranslation(lang);

  const [overlayUrl, setOverlayUrl] = useState("");
  const [overlayCopied, setOverlayCopied] = useState(false);
  const [schema, setSchema] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef(null);

  // Local Font Access API (Chromium) — best-effort list of installed fonts.
  const [localFonts, setLocalFonts] = useState([]);
  const [fontLoadStatus, setFontLoadStatus] = useState("");
  const [openGroups, setOpenGroups] = useState(() => new Set(OPEN_GROUPS));

  useEffect(() => {
    apiFetch("/chat-overlay/overlay-url")
      .then((res) => res.json())
      .then((data) => setOverlayUrl(data.url || ""))
      .catch(() => {});
    apiFetch("/chat-overlay/schema")
      .then((res) => res.json())
      .then((data) => setSchema(data))
      .catch(() => {});
    apiFetch("/chat-overlay/config")
      .then((res) => res.json())
      .then((data) => setCfg(data.config || {}))
      .catch(() => {})
      .finally(() => setLoaded(true));
    return () => clearTimeout(saveTimerRef.current);
  }, []);

  const loadLocalFonts = async () => {
    if (!window.queryLocalFonts) { setFontLoadStatus("unsupported"); return; }
    setFontLoadStatus("loading");
    try {
      const fonts = await window.queryLocalFonts();
      setLocalFonts([...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b)));
      setFontLoadStatus("");
    } catch {
      setFontLoadStatus("denied");
    }
  };

  const copyOverlayUrl = async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setOverlayCopied(true);
      setTimeout(() => setOverlayCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can copy from Settings instead.
    }
  };

  // Optimistic local update + debounced save. The overlay picks the change up
  // live over its WS connection once the POST lands.
  const set = useCallback((key, value) => {
    setCfg((prev) => {
      const next = { ...prev, [key]: value };
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        apiFetch("/chat-overlay/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(next),
        }).catch(() => {});
      }, 300);
      return next;
    });
  }, []);

  const sendTest = async (kind) => {
    try { await apiFetch(`/chat-overlay/test-${kind}`, { method: "POST" }); } catch { /* best-effort */ }
  };

  const setGroupOpen = (group, open) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (open) next.add(group); else next.delete(group);
      return next;
    });
  };

  if (!schema || !cfg) {
    return (
      <>
        <div style={styles.body}>
          <button style={styles.actionBtn} onClick={copyOverlayUrl} disabled={!overlayUrl}>
            <Link2 size={14} color="var(--accent)" /> {t("chatOverlayPanel.copyOverlay")}
          </button>
          <span style={styles.fieldLabel}>{t("chatOverlayPanel.hint")}</span>
        </div>
      </>
    );
  }

  const fieldsByGroup = new Map();
  for (const f of schema.fields) {
    if (!fieldsByGroup.has(f.group)) fieldsByGroup.set(f.group, []);
    fieldsByGroup.get(f.group).push(f);
  }

  const renderField = (f) => {
    const value = cfg[f.key] ?? f.default;
    const label = <label style={styles.fieldLabel}>{f.label}</label>;

    if (f.type === "toggle") {
      return (
        <div key={f.key} style={styles.row}>
          <span style={styles.rowLabel}>{f.label}</span>
          <Toggle checked={!!value} onChange={() => set(f.key, !value)} />
        </div>
      );
    }
    if (f.type === "slider") {
      return (
        <div key={f.key} style={styles.field}>
          {label}
          <div style={styles.sliderRow}>
            <input type="range" min={f.min} max={f.max} step={f.step || 0.01} value={value}
              onChange={(e) => set(f.key, Number(e.target.value))} style={{ flex: 1 }} />
            <span style={styles.sliderValue}>{value}</span>
          </div>
        </div>
      );
    }
    if (f.type === "color") {
      return (
        <div key={f.key} style={styles.field}>
          {label}
          <ColorField value={String(value)} onChange={(v) => set(f.key, v)} />
        </div>
      );
    }
    if (f.type === "select") {
      return (
        <div key={f.key} style={styles.field}>
          {label}
          <select value={String(value)} onChange={(e) => set(f.key, e.target.value)} disabled={!loaded}>
            {(f.options || []).map(([v, text]) => <option key={v} value={v}>{text}</option>)}
          </select>
        </div>
      );
    }
    if (f.type === "number") {
      return (
        <div key={f.key} style={styles.field}>
          {label}
          <input type="number" min={f.min} max={f.max} step={f.step || 1} value={value}
            onChange={(e) => set(f.key, Number(e.target.value))} disabled={!loaded} />
        </div>
      );
    }
    // text / font
    return (
      <div key={f.key} style={styles.field}>
        {label}
        <input
          list={f.type === "font" ? "chatOverlayFontList" : undefined}
          value={value}
          onChange={(e) => set(f.key, e.target.value)}
          disabled={!loaded}
        />
        {f.type === "font" && (
          <>
            <datalist id="chatOverlayFontList">
              {(localFonts.length ? localFonts : COMMON_FONTS).map((name) => <option key={name} value={name} />)}
            </datalist>
            <button type="button" style={{ ...styles.actionBtn, marginTop: 4 }} onClick={loadLocalFonts} disabled={fontLoadStatus === "loading"}>
              {fontLoadStatus !== "loading" && <Type size={14} color="var(--accent)" />}{" "}
              {fontLoadStatus === "loading" ? t("chatOverlayPanel.fontLoading") : t("chatOverlayPanel.fontLoadButton")}
            </button>
            {fontLoadStatus === "unsupported" && <span style={styles.errorText}>{t("chatOverlayPanel.fontUnsupported")}</span>}
            {fontLoadStatus === "denied" && <span style={styles.errorText}>{t("chatOverlayPanel.fontDenied")}</span>}
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <div style={styles.body}>
        <button style={styles.actionBtn} onClick={copyOverlayUrl} disabled={!overlayUrl} title={t("chatOverlayPanel.copyOverlayTitle")}>
          {overlayCopied ? <Check size={14} color="var(--accent)" /> : <Link2 size={14} color="var(--accent)" />}{" "}
          {overlayCopied ? t("chatOverlayPanel.copied") : t("chatOverlayPanel.copyOverlay")}
        </button>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("chatOverlayPanel.testSection")}</div>
        <div style={styles.row2}>
          <button type="button" style={styles.actionBtn} onClick={() => sendTest("message")}>
            <MessageCircle size={14} color="var(--accent)" /> {t("chatOverlayPanel.testMessage")}
          </button>
          <button type="button" style={styles.actionBtn} onClick={() => sendTest("redeem")}>
            <Gift size={14} color="var(--accent)" /> {t("chatOverlayPanel.testRedeem")}
          </button>
        </div>
        <button type="button" style={styles.actionBtn} onClick={() => sendTest("event")}>
          <PartyPopper size={14} color="var(--accent)" /> {t("chatOverlayPanel.testEvent")}
        </button>
        <span style={styles.fieldLabel}>{t("chatOverlayPanel.testHint")}</span>

        <div style={styles.divider} />

        {schema.groups.map((group) => {
          const fields = fieldsByGroup.get(group) || [];
          if (!fields.length) return null;
          const open = openGroups.has(group);
          return (
            <details key={group} open={open} onToggle={(e) => setGroupOpen(group, e.currentTarget.open)} style={styles.details}>
              <summary style={styles.summary}>{group}</summary>
              <div style={styles.groupBody}>{fields.map(renderField)}</div>
            </details>
          );
        })}
      </div>
      <div style={styles.hint}>{t("chatOverlayPanel.hint")}</div>
    </>
  );
}

const styles = {
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "14px 12px",
    overflowY: "auto",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  row2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  rowLabel: {
    fontSize: 12,
    color: "var(--text)",
  },
  toggle: {
    width: 38,
    height: 22,
    borderRadius: 11,
    padding: 3,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    flexShrink: 0,
  },
  toggleKnob: {
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: "50%",
    background: "#fff",
    transition: "transform 0.15s",
  },
  actionBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text)",
    fontSize: 12,
    padding: "6px 10px",
    textAlign: "left",
  },
  divider: {
    height: 1,
    background: "var(--border)",
    margin: "2px 0",
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  colorInput: {
    width: "100%",
    height: 28,
    padding: 2,
  },
  colorRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  clearBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    padding: "4px 6px",
    borderRadius: 6,
    flexShrink: 0,
  },
  inherit: {
    fontSize: 10,
    color: "var(--text-muted)",
    fontStyle: "italic",
  },
  sliderRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  sliderValue: {
    fontSize: 11,
    color: "var(--text-muted)",
    minWidth: 28,
    textAlign: "right",
  },
  details: {
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: "4px 8px",
    background: "var(--surface2)",
  },
  summary: {
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    color: "var(--text)",
    padding: "4px 0",
  },
  groupBody: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: "8px 0 4px",
  },
  errorText: {
    fontSize: 10,
    color: "var(--red)",
  },
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
  },
};
