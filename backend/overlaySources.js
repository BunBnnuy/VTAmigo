// OBS pages that can be placed inside a custom layout. Keep paths fixed here:
// a saved layout stores only a source id, never a user-supplied iframe URL.
const SOURCES = Object.freeze([
  { id: "avatar", name: "Bot avatar", path: "/overlay/avatar", w: 360, h: 360 },
  { id: "reactive-avatar", name: "Reactive avatar", path: "/overlay/avatar-reactive", w: 360, h: 360 },
  { id: "chat", name: "Chat & events", path: "/overlay/chat", w: 500, h: 680 },
  { id: "xp", name: "XP bar", path: "/overlay/xp?ranking=0", w: 520, h: 220 },
  { id: "xp-ranking", name: "XP ranking", path: "/overlay/xp-ranking", w: 420, h: 440 },
  { id: "video", name: "Video queue", path: "/overlay/video", w: 960, h: 540 },
  { id: "shoutout", name: "Shoutouts", path: "/overlay/shoutout", w: 1280, h: 720 },
]);

const byId = new Map(SOURCES.map((source) => [source.id, source]));

function getSource(id) {
  return byId.get(id);
}

function sourceUrl(id, token) {
  const source = getSource(id);
  return source ? `${source.path}${source.path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : null;
}

module.exports = { SOURCES, getSource, sourceUrl };
