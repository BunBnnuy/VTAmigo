import React, { useState, useRef, useEffect } from "react";
import { LayoutGrid } from "lucide-react";
import { PANEL_META, DEFAULT_PANEL_LAYOUT } from "./WindowManager.jsx";

// Top-bar button + dropdown listing every dashboard window with a checkbox
// to show/hide it — the only way to bring back a window closed via its X.
export default function PanelsMenu({ panelLayout, onUpdateWindow, t }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const toggle = (id, closed) => onUpdateWindow(id, { closed: !closed });

  return (
    <div style={styles.wrap} ref={ref}>
      <button style={styles.settingsBtn} onClick={() => setOpen((o) => !o)} title={t("app.panelsTitle")}>
        <LayoutGrid size={14} color="var(--accent)" />
      </button>
      {open && (
        <div style={styles.dropdown}>
          {PANEL_META.map(({ id, titleKey }) => {
            const layout = panelLayout.windows[id] || DEFAULT_PANEL_LAYOUT.windows[id];
            const closed = !!layout.closed;
            return (
              <label key={id} style={styles.row}>
                <input type="checkbox" checked={!closed} onChange={() => toggle(id, closed)} />
                <span>{t(titleKey)}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

const styles = {
  wrap: {
    position: "relative",
  },
  settingsBtn: {
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
  dropdown: {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: 4,
    zIndex: 200,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 6,
    padding: 8,
    minWidth: 180,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--text)",
    cursor: "pointer",
  },
};
