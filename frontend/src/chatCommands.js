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

export function isSongRequest(text) {
  return typeof text === "string" && SONG_REQUEST.test(text);
}
