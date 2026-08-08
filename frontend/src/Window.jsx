import React from "react";
import { Rnd } from "react-rnd";

const GRID = 20;
const HEADER_HEIGHT = 36;

// Shared chrome for every dashboard panel: a draggable/resizable frame
// (react-rnd) with a title bar, a collapse toggle, and a close button.
// Panels themselves only render their inner content — `children` stays
// mounted at all times and collapsing just hides it with CSS, so a panel's
// fetched data/form state survives a collapse cycle instead of being torn
// down and refetched. Collapsing shrinks the window down to just its title
// bar (full width, minimal height) rather than a narrow vertical strip.
// Closing removes the window from the canvas entirely — reopened later from
// the Panels menu in the top bar (see App.jsx).
export default function Window({
  id, title, layout, onChange, onFocus,
  minWidth = 200, minHeight = 120,
  dataTour, children,
}) {
  const { x, y, w, h, z, collapsed } = layout;

  const toggleCollapsed = (e) => {
    e.stopPropagation();
    onChange({ collapsed: !collapsed });
  };

  const close = (e) => {
    e.stopPropagation();
    onChange({ closed: true });
  };

  return (
    <Rnd
      size={collapsed ? { width: w, height: HEADER_HEIGHT } : { width: w, height: h }}
      position={{ x, y }}
      minWidth={minWidth}
      minHeight={collapsed ? HEADER_HEIGHT : minHeight}
      dragGrid={[GRID, GRID]}
      resizeGrid={[GRID, GRID]}
      dragHandleClassName="window-titlebar"
      enableResizing={!collapsed}
      bounds="parent"
      style={{ zIndex: z }}
      onDragStop={(e, d) => onChange({ x: d.x, y: d.y })}
      onResizeStop={(e, dir, ref, delta, pos) => {
        onChange({ w: ref.offsetWidth, h: ref.offsetHeight, x: pos.x, y: pos.y });
      }}
      onMouseDown={onFocus}
      data-tour={dataTour}
    >
      <div style={styles.frame}>
        <div className="window-titlebar" style={styles.header}>
          <span style={styles.title}>{title}</span>
          <div style={styles.headerBtns}>
            <button style={styles.headerBtn} onClick={toggleCollapsed} title={title}>
              {collapsed ? "▾" : "▴"}
            </button>
            <button style={styles.headerBtn} onClick={close} title={title}>
              ✕
            </button>
          </div>
        </div>
        <div style={{ ...styles.body, display: collapsed ? "none" : "flex" }}>{children}</div>
      </div>
    </Rnd>
  );
}

const styles = {
  frame: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--surface)",
    overflow: "hidden",
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
    userSelect: "none",
    cursor: "move",
  },
  headerBtns: {
    display: "flex",
    gap: 4,
    flexShrink: 0,
  },
  title: {
    fontWeight: 700,
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  headerBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    fontSize: 12,
    padding: "3px 7px",
    flexShrink: 0,
  },
  body: {
    flex: 1,
    flexDirection: "column",
    overflowY: "auto",
    minHeight: 0,
  },
};
