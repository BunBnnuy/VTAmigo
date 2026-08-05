import React, { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "./api.js";
import { useTranslation } from "./i18n/index.js";

const DEFAULTS = {
  max: 25, fade: 0, showEvents: true, showBanner: true, bannerDuration: 6000,
  showRedeems: true, direction: "up", align: "left", timestamps: false,
  userColor: true, animate: true, lang: "en", width: 420, fontsize: 16,
  bg: 0.35, textcolor: "ffffff",
};

function Toggle({ checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{ ...styles.toggle, background: checked ? "var(--purple)" : "var(--border)" }}
    >
      <span style={{ ...styles.toggleKnob, transform: checked ? "translateX(16px)" : "translateX(0)" }} />
    </button>
  );
}

export default function ChatOverlayPanel({ lang }) {
  const { t } = useTranslation(lang);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("chatOverlayPanelCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("chatOverlayPanelCollapsed", next ? "1" : "0");
      } catch {
        // localStorage unavailable — collapse choice won't persist.
      }
      return next;
    });
  };

  const [overlayUrl, setOverlayUrl] = useState("");
  const [overlayCopied, setOverlayCopied] = useState(false);
  const [cfg, setCfg] = useState(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    apiFetch("/chat-overlay/overlay-url")
      .then((res) => res.json())
      .then((data) => setOverlayUrl(data.url || ""))
      .catch(() => {});
    apiFetch("/chat-overlay/config")
      .then((res) => res.json())
      .then((data) => setCfg({ ...DEFAULTS, ...(data.config || {}) }))
      .catch(() => {})
      .finally(() => setLoaded(true));
    return () => clearTimeout(saveTimerRef.current);
  }, []);

  const copyOverlayUrl = async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setOverlayCopied(true);
      setTimeout(() => setOverlayCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — user can still copy from Settings instead.
    }
  };

  // Optimistic local update + debounced save — the overlay picks up the
  // change live over its WS connection once the POST lands (see
  // backend/index.js POST /chat-overlay/config and backend/overlay/chat.html).
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

  if (collapsed) {
    return (
      <div style={styles.collapsedPanel}>
        <button style={styles.collapseBtn} onClick={toggleCollapsed} title={t("chatOverlayPanel.expand")}>
          ⟨
        </button>
        <span style={styles.verticalTitle}>{t("chatOverlayPanel.title")}</span>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>{t("chatOverlayPanel.title")}</span>
        <button style={styles.collapseBtn} onClick={toggleCollapsed} title={t("chatOverlayPanel.collapse")}>
          ⟩
        </button>
      </div>
      <div style={styles.body}>
        <button style={styles.actionBtn} onClick={copyOverlayUrl} disabled={!overlayUrl} title={t("chatOverlayPanel.copyOverlayTitle")}>
          {overlayCopied ? t("chatOverlayPanel.copied") : t("chatOverlayPanel.copyOverlay")}
        </button>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("chatOverlayPanel.feedSection")}</div>

        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.maxMessages")}</label>
          <input type="number" min={1} max={200} value={cfg.max} onChange={(e) => set("max", Number(e.target.value))} disabled={!loaded} />
        </div>
        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.fade")}</label>
          <input type="number" min={0} max={600} value={cfg.fade} onChange={(e) => set("fade", Number(e.target.value))} disabled={!loaded} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("chatOverlayPanel.showEvents")}</span>
          <Toggle checked={cfg.showEvents} onChange={() => set("showEvents", !cfg.showEvents)} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("chatOverlayPanel.showRedeems")}</span>
          <Toggle checked={cfg.showRedeems} onChange={() => set("showRedeems", !cfg.showRedeems)} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("chatOverlayPanel.showBanner")}</span>
          <Toggle checked={cfg.showBanner} onChange={() => set("showBanner", !cfg.showBanner)} />
        </div>
        {cfg.showBanner && (
          <div style={styles.field}>
            <label style={styles.fieldLabel}>{t("chatOverlayPanel.bannerDuration")}</label>
            <input type="number" min={1000} max={30000} step={500} value={cfg.bannerDuration} onChange={(e) => set("bannerDuration", Number(e.target.value))} disabled={!loaded} />
          </div>
        )}
        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.direction")}</label>
          <select value={cfg.direction} onChange={(e) => set("direction", e.target.value)} disabled={!loaded}>
            <option value="up">{t("chatOverlayPanel.directionUp")}</option>
            <option value="down">{t("chatOverlayPanel.directionDown")}</option>
          </select>
        </div>
        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.align")}</label>
          <select value={cfg.align} onChange={(e) => set("align", e.target.value)} disabled={!loaded}>
            <option value="left">{t("chatOverlayPanel.alignLeft")}</option>
            <option value="right">{t("chatOverlayPanel.alignRight")}</option>
          </select>
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("chatOverlayPanel.timestamps")}</span>
          <Toggle checked={cfg.timestamps} onChange={() => set("timestamps", !cfg.timestamps)} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("chatOverlayPanel.userColor")}</span>
          <Toggle checked={cfg.userColor} onChange={() => set("userColor", !cfg.userColor)} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>{t("chatOverlayPanel.animate")}</span>
          <Toggle checked={cfg.animate} onChange={() => set("animate", !cfg.animate)} />
        </div>
        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.eventLang")}</label>
          <select value={cfg.lang} onChange={(e) => set("lang", e.target.value)} disabled={!loaded}>
            <option value="en">English</option>
            <option value="es">Español</option>
          </select>
        </div>

        <div style={styles.divider} />

        <div style={styles.sectionLabel}>{t("chatOverlayPanel.appearanceSection")}</div>

        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.width")}</label>
          <input type="number" min={200} max={1200} value={cfg.width} onChange={(e) => set("width", Number(e.target.value))} disabled={!loaded} />
        </div>
        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.fontSize")}</label>
          <input type="number" min={8} max={64} value={cfg.fontsize} onChange={(e) => set("fontsize", Number(e.target.value))} disabled={!loaded} />
        </div>
        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.bgOpacity", { pct: Math.round(cfg.bg * 100) })}</label>
          <input type="range" min={0} max={1} step={0.05} value={cfg.bg} onChange={(e) => set("bg", Number(e.target.value))} disabled={!loaded} />
        </div>
        <div style={styles.field}>
          <label style={styles.fieldLabel}>{t("chatOverlayPanel.textColor")}</label>
          <input type="color" value={"#" + cfg.textcolor} onChange={(e) => set("textcolor", e.target.value.replace(/^#/, ""))} disabled={!loaded} style={styles.colorInput} />
        </div>
      </div>
      <div style={styles.hint}>{t("chatOverlayPanel.hint")}</div>
    </div>
  );
}

const styles = {
  panel: {
    width: 240,
    minWidth: 200,
    display: "flex",
    flexDirection: "column",
    borderLeft: "1px solid var(--border)",
    background: "var(--surface)",
    overflow: "hidden",
    flexShrink: 0,
  },
  collapsedPanel: {
    width: 28,
    minWidth: 28,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    borderLeft: "1px solid var(--border)",
    background: "var(--surface)",
    flexShrink: 0,
    paddingTop: 10,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  title: {
    fontWeight: 700,
    fontSize: 13,
  },
  collapseBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    fontSize: 12,
    padding: "3px 7px",
  },
  verticalTitle: {
    writingMode: "vertical-rl",
    fontWeight: 700,
    fontSize: 13,
    color: "var(--text)",
    whiteSpace: "nowrap",
    marginTop: 10,
  },
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
  rowLabel: {
    fontSize: 12,
    color: "var(--text)",
  },
  toggle: {
    width: 34,
    height: 18,
    borderRadius: 9,
    padding: 2,
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
  toggleKnob: {
    width: 14,
    height: 14,
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
  hint: {
    fontSize: 11,
    color: "var(--text-muted)",
    padding: "10px 12px",
    borderTop: "1px solid var(--border)",
  },
};
