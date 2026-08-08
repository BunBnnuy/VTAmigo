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
    chat:           { x: 0,    y: 0,   w: 480, h: 560, z: 1, collapsed: false },
    responses:      { x: 500,  y: 0,   w: 480, h: 560, z: 2, collapsed: false },
    quickControls:  { x: 1000, y: 0,   w: 260, h: 280, z: 3, collapsed: false },
    videoQueue:     { x: 1000, y: 300, w: 260, h: 280, z: 4, collapsed: false },
    streamSettings: { x: 1280, y: 0,   w: 260, h: 400, z: 5, collapsed: false },
    chatOverlay:    { x: 1280, y: 420, w: 260, h: 400, z: 6, collapsed: false },
  },
};

const WINDOW_IDS = Object.keys(DEFAULT_PANEL_LAYOUT.windows);

// Fills in any window key missing from a saved layout (new panel added in a
// later release, or a user who never had one) with its default position —
// merged per-key rather than shallow-merged, so a partially-saved layout
// doesn't drop windows the user never touched.
export function mergePanelLayout(saved) {
  return {
    windows: { ...DEFAULT_PANEL_LAYOUT.windows, ...(saved?.windows || {}) },
  };
}

export default function WindowManager({
  panelLayout, onUpdateWindow, onFocusWindow, t,
  chatFeedProps, responsePanelProps, quickControlsProps, videoQueueProps, lang,
}) {
  const windowFor = (id, title, dataTour, node) => (
    <Window
      key={id}
      id={id}
      title={title}
      dataTour={dataTour}
      layout={panelLayout.windows[id] || DEFAULT_PANEL_LAYOUT.windows[id]}
      onChange={(patch) => onUpdateWindow(id, patch)}
      onFocus={() => onFocusWindow(id)}
    >
      {node}
    </Window>
  );

  return (
    <div style={styles.canvas}>
      {windowFor("chat", t("app.liveChat"), "live-chat", <ChatFeed {...chatFeedProps} />)}
      {windowFor("responses", t("responsePanel.title"), "ai-response", <ResponsePanel {...responsePanelProps} />)}
      {windowFor("quickControls", t("quickControls.title"), null, <QuickControls {...quickControlsProps} />)}
      {windowFor("videoQueue", t("videoQueue.title"), null, <VideoQueue {...videoQueueProps} lang={lang} />)}
      {windowFor("streamSettings", t("streamSettingsPanel.title"), null, <StreamSettingsPanel lang={lang} />)}
      {windowFor("chatOverlay", t("chatOverlayPanel.title"), null, <ChatOverlayPanel lang={lang} />)}
    </div>
  );
}

const styles = {
  canvas: {
    flex: 1,
    position: "relative",
    overflow: "auto",
    background: "var(--bg)",
    minWidth: 2000,
    minHeight: 1200,
  },
};
