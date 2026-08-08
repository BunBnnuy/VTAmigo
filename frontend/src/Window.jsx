import React from "react";
import { Rnd } from "react-rnd";

const GRID = 20;
const COLLAPSED_SIZE = { width: 28, height: 140 };

// Shared chrome for every dashboard panel: a draggable/resizable frame
// (react-rnd) with a title bar and a collapse toggle. Panels themselves only
// render their inner content — `children` stays mounted at all times and
// collapsing just hides it with CSS, so a panel's fetched data/form state
// survives a collapse cycle instead of being torn down and refetched.
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

  return (
    <Rnd
      size={collapsed ? COLLAPSED_SIZE : { width: w, height: h }}
      position={{ x, y }}
      minWidth={collapsed ? COLLAPSED_SIZE.width : minWidth}
      minHeight={collapsed ? COLLAPSED_SIZE.height : minHeight}
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
      <div style={collapsed ? styles.collapsedFrame : styles.frame}>
        <div className="window-titlebar" style={collapsed ? styles.collapsedHeader : styles.header}>
          {collapsed ? (
            <>
              <button style={styles.collapseBtn} onClick={toggleCollapsed} title={title}>
                ⟨
              </button>
              <span style={styles.verticalTitle}>{title}</span>
            </>
          ) : (
            <>
              <span style={styles.title}>{title}</span>
              <button style={styles.collapseBtn} onClick={toggleCollapsed} title={title}>
                ⟩
              </button>
            </>
          )}
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
  collapsedFrame: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    border: "1px solid var(--border)",
    borderRadius: 6,
    background: "var(--surface)",
    overflow: "hidden",
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
    paddingTop: 10,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 10px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
    userSelect: "none",
    cursor: "move",
  },
  collapsedHeader: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    userSelect: "none",
    cursor: "move",
  },
  title: {
    fontWeight: 700,
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  collapseBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    color: "var(--text-muted)",
    fontSize: 12,
    padding: "3px 7px",
    flexShrink: 0,
  },
  verticalTitle: {
    writingMode: "vertical-rl",
    fontWeight: 700,
    fontSize: 13,
    color: "var(--text)",
    whiteSpace: "nowrap",
  },
  body: {
    flex: 1,
    flexDirection: "column",
    overflowY: "auto",
    minHeight: 0,
  },
};
