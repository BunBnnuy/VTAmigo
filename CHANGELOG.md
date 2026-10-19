# Changelog

## 2026-10-19

- Added **KittenTTS** as a third TTS provider alongside Windows TTS and Piper.
  - Local neural voices (Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki, Leo), fully offline, no API key.
  - Works in all three voice outputs: this browser, the OBS Bot voice overlay, and Both.
  - The Python worker starts on first use and exits after 10 idle minutes, so it only holds RAM while the bot is talking.
  - The lightweight ONNX models are English-only; keep Piper selected for Spanish. KittenTTS 2 is multilingual but needs ~2.3 GB of RAM, above the backend's 2 GB cap.
  - `server/setup.sh` now creates `backend/kitten/.venv` and installs the ONNX dependencies.
- Added **Kokoro-82M** as a fourth TTS provider, with official Spanish speakers.
  - Voices: Dora (ES), Alex (ES), Santa (ES), plus Heart, Bella, Nova, Michael, Fenrir, Emma and George in English.
  - Apache 2.0, fully offline, ~640 MB RSS while active; the worker exits after 10 idle minutes.
  - The 311 MB fp32 ONNX model and voice bank are downloaded by `server/setup.sh` with pinned SHA256 hashes.
  - This is the recommended neural provider for Spanish; KittenTTS stays as the lighter English-only option and Piper as the ultralight one.
  - The two Python sidecars now share `backend/ttsWorker.js` for spawning, the JSON protocol, concurrency caps and idle shutdown.
- Experimental: `KITTEN_LANGUAGE` (e.g. `KITTEN_LANGUAGE=es`) swaps KittenTTS's English G2P for another espeak language while keeping the English-trained voice, so the lightweight model can read Spanish with an accent.
- Unified the TTS voice picker in Settings and Quick Controls into one list across engines (`Windows/...` or `Browser/...` for system/browser voices, `Piper/...`, `Kitten/...`, `Kokoro/...`). Choosing a voice now also chooses its provider; the old provider dropdown is gone.

## 2026-09-28

- Rebuilt the **chat overlay** with a full set of appearance and behavior options.
  - Five layout modes (vertical, horizontal, random positions, special horizontal/vertical) with vertical and horizontal alignment.
  - Per-role styling for the streamer, moderators, VIPs, subscriber tiers and three custom roles: colors, tags, icons, arrival animations and sounds.
  - Separate **Name box** and **Message box** controls: background and opacity, border, corner radius, padding, tilt, shadows, font size and weight, and text color.
  - Event alerts (follows, subs, gift subs, raids, bits, tips) with custom wording, plus emote and badge sizing, timestamps, pronouns and message/command filters.
  - New settings apply live — OBS does not need a Browser Source reload.
  - If you customized the old chat overlay, set it up again: the options were rebuilt.
- Added **app overlays** to the Overlay Studio.
  - Place the chat, XP bar and ranking, video queue, shoutouts and avatars inside a custom layout, alongside your own images, text, video and audio.
  - Each app overlay previews with a representative example in the editor while it has no data yet.
- Video queue overlay: new **Show video** and **Show progress bar** toggles, each independent.
- Fixed emotes not rendering in the Live Chat feed and on messages sent from the app.
  - Native Twitch emotes now resolve by name, and 7TV channel emote sets load correctly.
- Documented the Fast → Dev → Master promotion workflow and refreshed the server setup notes.

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
- Added the independent **Avatar Reactivo** feature.
  - Detects streamer microphone activity without transcribing or playing audio.
  - Supports separate speaking and silent images with its own OBS overlay.
  - Keeps reactive avatar images separate from the Avatar Bot images.
- Added a chat XP top-five ranking panel and a dedicated OBS overlay with a copy button.
- Removed the 24-hour cooldown from memory downloads while keeping concurrent-download protection.
- Updated window names for Avatar Bot, Avatar Reactivo, and AI quick controls.
- Removed the per-user AI provider selector from Settings.
