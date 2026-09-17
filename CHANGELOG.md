# Changelog

## 2026-09-17

- Added an independent **Chat TTS Messages** panel.
  - Enable or disable TTS for chat commands.
  - Configure the command, browser voice, and message template.
  - Supported placeholders: `{user}`, `{message}`, and `{mensaje}`.
  - Default template: `{user} dijo: {mensaje}`.
- Fixed Twitch EventSub reconnection handling.
  - Reconnects now keep the existing subscriptions.
  - Old sockets no longer report false disconnects after a successful handoff.
  - EventSub now requests a 30-second keepalive window with local grace time.
- Fixed the development deployment workflow so it builds `frontend/dist` after dependency installation.
- Updated `multer` to a secure release.
