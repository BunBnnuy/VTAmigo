// Chat messages that are commands for the app rather than things said to the
// co-host. They stay visible in the chat feed — the streamer still wants to
// see them — but are kept out of the AI buffer so the co-host doesn't answer
// them out loud.

// !sr <url|id|title> is the song request handled by the video queue (see
// backend/sessions.js handleSongRequest). Matches a bare "!sr" too, which is
// a malformed request the backend ignores but is just as much noise for the
// AI. Anchored with (\s|$) rather than \b so "!srsomething" — a different
// word that merely starts the same way — is left alone.
const SONG_REQUEST = /^\s*!sr(\s|$)/i;

// !so <username> triggers a shoutout clip on the overlay (see
// backend/sessions.js handleShoutout). Mod-only, but the AI shouldn't answer
// it regardless of who typed it, so it's filtered here too.
const SHOUTOUT = /^\s*!so(\s|$)/i;

export function isSongRequest(text) {
  return typeof text === "string" && SONG_REQUEST.test(text);
}

export function isShoutout(text) {
  return typeof text === "string" && SHOUTOUT.test(text);
}

// Any app command that must stay out of the AI's buffer — the chat feed still
// shows it, the co-host just never replies to it.
export function isAppCommand(text) {
  return isSongRequest(text) || isShoutout(text);
}
