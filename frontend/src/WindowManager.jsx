import React, { useEffect, useRef } from "react";
import Window from "./Window.jsx";
import ChatFeed from "./ChatFeed.jsx";
import ResponsePanel from "./ResponsePanel.jsx";
import QuickControls from "./QuickControls.jsx";
import VideoQueue from "./VideoQueue.jsx";
import StreamSettingsPanel from "./StreamSettingsPanel.jsx";
import ChatOverlayPanel from "./ChatOverlayPanel.jsx";
import ChatOverlayPreview from "./ChatOverlayPreview.jsx";
import AvatarPanel from "./AvatarPanel.jsx";
import ActivityPanel from "./ActivityPanel.jsx";

export const DEFAULT_PANEL_LAYOUT = {
  windows: {
    chat:              { x: 20,   y: 20,  w: 480, h: 560, z: 1, collapsed: false, closed: false },
    responses:         { x: 520,  y: 20,  w: 480, h: 560, z: 2, collapsed: false, closed: false },
    quickControls:     { x: 1020, y: 20,  w: 260, h: 280, z: 3, collapsed: false, closed: false },
    videoQueue:        { x: 1020, y: 320, w: 260, h: 280, z: 4, collapsed: false, closed: false },
    streamSettings:    { x: 1300, y: 20,  w: 260, h: 400, z: 5, collapsed: false, closed: false },
    chatOverlay:       { x: 1300, y: 440, w: 260, h: 400, z: 6, collapsed: false, closed: false },
    avatar:            { x: 1020, y: 620, w: 260, h: 300, z: 7, collapsed: false, closed: false },
    chatOverlayPreview:{ x: 520,  y: 600, w: 480, h: 320, z: 8, collapsed: false, closed: false },
    activity:          { x: 1580, y: 20,  w: 320, h: 480, z: 9, collapsed: false, closed: false },
  },
};

// Stable list of every window's ID + i18n title key + optional data-tour
// hook, in display order — used both to render the canvas below and to
// build the "Panels" show/hide menu in App.jsx, so the two never drift.
export const PANEL_META = [
  { id: "chat", titleKey: "app.liveChat", dataTour: "live-chat" },
  { id: "responses", titleKey: "responsePanel.title", dataTour: "ai-response" },
  { id: "quickControls", titleKey: "quickControls.title", dataTour: null },
  { id: "videoQueue", titleKey: "videoQueue.title", dataTour: null },
  { id: "streamSettings", titleKey: "streamSettingsPanel.title", dataTour: null },
  { id: "chatOverlay", titleKey: "chatOverlayPanel.title", dataTour: null },
  { id: "chatOverlayPreview", titleKey: "chatOverlayPreview.title", dataTour: null },
  { id: "avatar", titleKey: "avatarPanel.title", dataTour: null },
  { id: "activity", titleKey: "activityPanel.title", dataTour: null },
];

// Fills in any window key missing from a saved layout (new panel added in a
// later release, or a user who never had one) with its default position —
// merged per-key rather than shallow-merged, so a partially-saved layout
// doesn't drop windows the user never touched.
export function mergePanelLayout(saved) {
  const windows = { ...DEFAULT_PANEL_LAYOUT.windows };
  for (const [id, w] of Object.entries(saved?.windows || {})) {
    windows[id] = { ...windows[id], ...w };
  }
  return { windows };
}

export default function WindowManager({
  panelLayout, onUpdateWindow, onFocusWindow, t,
  chatFeedProps, responsePanelProps, quickControlsProps, videoQueueProps,
  avatarPanelProps, activityPanelProps, lang,
}) {
  // `layout` is handed to panels that need to know whether they're actually on
  // screen — <Window> keeps collapsed children mounted (hidden with CSS) so
  // their state survives, which is the wrong trade for the overlay preview.
  const canvasRef = useRef(null);

  // `.canvas` is a scrollable viewport onto the larger `.surface` below (see
  // its comment) — browsers don't guarantee a fresh scrollable element
  // starts at (0,0) on mount (e.g. scroll anchoring can settle wherever a
  // focused/anchored descendant happens to sit), so pin it explicitly.
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.scrollLeft = 0;
      canvasRef.current.scrollTop = 0;
    }
  }, []);

  const contentFor = (id, layout) => {
    switch (id) {
      case "chat": return <ChatFeed {...chatFeedProps} />;
      case "responses": return <ResponsePanel {...responsePanelProps} />;
      case "quickControls": return <QuickControls {...quickControlsProps} />;
      case "videoQueue": return <VideoQueue {...videoQueueProps} lang={lang} />;
      case "streamSettings": return <StreamSettingsPanel lang={lang} />;
      case "chatOverlay": return <ChatOverlayPanel lang={lang} />;
      case "chatOverlayPreview": return <ChatOverlayPreview lang={lang} visible={!layout.collapsed} />;
      case "avatar": return <AvatarPanel {...avatarPanelProps} lang={lang} />;
      case "activity": return <ActivityPanel {...activityPanelProps} lang={lang} />;
      default: return null;
    }
  };

  return (
    <div ref={canvasRef} style={styles.canvas}>
      {/* Window.jsx's <Rnd bounds="parent"> clamps drag/resize to this
          element's box, not `.canvas`'s — a fixed, generously oversized
          surface so windows have room to be dragged out past whatever's
          currently visible. `.canvas` itself stays exactly the size of its
          flex slot (viewport minus the top/bottom bars) and scrolls to
          reveal the rest of the surface; see WindowManager's git history
          for why `.canvas` can't just be big itself (it used to be, via
          minWidth/minHeight, until that let the whole page grow past the
          viewport and clip the top/bottom bars). */}
      <div style={styles.surface}>
        {PANEL_META.map(({ id, titleKey, dataTour }) => {
          const layout = panelLayout.windows[id] || DEFAULT_PANEL_LAYOUT.windows[id];
          if (layout.closed) return null;
          return (
            <Window
              key={id}
              id={id}
              title={t(titleKey)}
              dataTour={dataTour}
              layout={layout}
              onChange={(patch) => onUpdateWindow(id, patch)}
              onFocus={() => onFocusWindow(id)}
            >
              {contentFor(id, layout)}
            </Window>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  canvas: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    position: "relative",
    overflow: "auto",
    background: "var(--bg)",
  },
  surface: {
    position: "relative",
    width: 2000,
    height: 1200,
  },
};
