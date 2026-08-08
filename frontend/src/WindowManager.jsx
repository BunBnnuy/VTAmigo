import React from "react";
import Window from "./Window.jsx";
import ChatFeed from "./ChatFeed.jsx";
import ResponsePanel from "./ResponsePanel.jsx";
import QuickControls from "./QuickControls.jsx";
import VideoQueue from "./VideoQueue.jsx";
import StreamSettingsPanel from "./StreamSettingsPanel.jsx";
import ChatOverlayPanel from "./ChatOverlayPanel.jsx";

export const DEFAULT_PANEL_LAYOUT = {
  windows: {
    chat:           { x: 20,   y: 20,  w: 480, h: 560, z: 1, collapsed: false, closed: false },
    responses:      { x: 520,  y: 20,  w: 480, h: 560, z: 2, collapsed: false, closed: false },
    quickControls:  { x: 1020, y: 20,  w: 260, h: 280, z: 3, collapsed: false, closed: false },
    videoQueue:     { x: 1020, y: 320, w: 260, h: 280, z: 4, collapsed: false, closed: false },
    streamSettings: { x: 1300, y: 20,  w: 260, h: 400, z: 5, collapsed: false, closed: false },
    chatOverlay:    { x: 1300, y: 440, w: 260, h: 400, z: 6, collapsed: false, closed: false },
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
  chatFeedProps, responsePanelProps, quickControlsProps, videoQueueProps, lang,
}) {
  const contentFor = (id) => {
    switch (id) {
      case "chat": return <ChatFeed {...chatFeedProps} />;
      case "responses": return <ResponsePanel {...responsePanelProps} />;
      case "quickControls": return <QuickControls {...quickControlsProps} />;
      case "videoQueue": return <VideoQueue {...videoQueueProps} lang={lang} />;
      case "streamSettings": return <StreamSettingsPanel lang={lang} />;
      case "chatOverlay": return <ChatOverlayPanel lang={lang} />;
      default: return null;
    }
  };

  return (
    <div style={styles.canvas}>
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
            {contentFor(id)}
          </Window>
        );
      })}
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
};
