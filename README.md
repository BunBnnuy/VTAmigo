# VTAmigo

An AI co-host companion for Twitch and TikTok Live streams. It reads chat in real time, batches messages, and generates spoken responses using your choice of AI provider — with VTube Studio lip-sync or a plain image-swap avatar overlay for OBS.

VTAmigo runs two ways: as a local Electron app on your own PC, or as a hosted multi-account web app (see `server/README.md`) with per-user accounts, tiers, and an admin panel — the same frontend/backend either way. Both ways sit behind Twitch OAuth login plus a one-time admin approval — see [Setup](#setup).

## Features

- **Twitch & TikTok Live** chat reading
- **AI responses** via Claude CLI — the same code path also supports Grok CLI, AGY CLI, and ChatGPT (OpenAI API), but the provider picker in Settings is currently locked to Claude ("only Claude available for now") while the others are finished
- **Persistent memory & Session Export** — Claude, Grok, and AGY CLI each keep a long-lived CLI session (resumed across app restarts) so the co-host remembers past conversations. Export session memory seamlessly between providers (e.g., Grok -> AGY) from Settings. Delete `backend/.agent-sessions.json` to reset.
- **Text-to-Speech** with configurable voice, speed, and volume — Windows TTS (default, free), ElevenLabs (currently disabled in Settings), or Piper (local offline Spanish voices, CPU-only); Piper clips drive the lip-sync/avatar with their real audio duration and fall back to Windows TTS if generation fails
- **VTube Studio lip-sync** — mouth animation driven by phoneme timing; each account gets its own independent VTS connection (falls back to the default connection if the caller has no device tunnel). Hidden from Settings by default in favor of the simpler avatar overlay below, but still fully supported.
- **Avatar overlay (no VTS needed)** — upload speaking/silent images (JPEG/PNG/GIF/WebP, 5MB max) and add an OBS browser source that swaps between them while the co-host talks; configured from Quick Controls, no VTube Studio required
- **Chat overlay** — a Twitch-chat OBS browser source with two themes: a "default" nine-slice-background renderer, or "bubbles", a decorated speech-bubble theme (emote/badge rendering, custom flower ornaments, per-event alert copy). Both themes share message limits, fade timing, colors/fonts, and bot-message filtering, all configured from the Chat Overlay panel.
- **Custom Overlay Builder** — a freeform OBS overlay designer at `/overlay-builder`: a 1920x1080 canvas with image, text, video, and sound layers (HSB filters on images; autoplay/loop/trigger options on video and sound); text layers support `{token}` interpolation for live Twitch event data (e.g. `{follower.username}`, `{cheer.bits}`). Save multiple named layouts per account, each with its own OBS URL, backed by a per-account media library with per-file-type size caps and a 100MB total quota.
- **Activity Panel** — a persisted feed of follows, subs, resubs, gift subs, raids, and cheers; backfilled from Twitch's API on first connect and stored server-side, so it survives page reloads (not just a live-only feed)
- **Twitch EventSub** — reacts to follows, subs, raids, cheers, and channel point redeems; also what feeds the Activity Panel and Overlay Builder's live `{token}` data
- **Stream Settings panel** — change your live Twitch title and category from the site (with category search/autocomplete), or hands-free via voice commands (see below)
- **Voice control & commands** — a 4-way mic mode in Settings/Quick Controls: **Off** (mic disabled), **Voice to text** (transcribes your mic and includes it in the AI's context, shown in the chat feed), **Commands only** (nothing added to chat — only spoken commands like "change the title to ..." or "change the category to ..." are acted on), or **Full** (both at once). Commands only cover changing your live Twitch title/category so far. Chromium-based browsers only (Web Speech API).
- **Reddit stories** — reads aloud random stories from configurable subreddits when chat is idle; currently disabled (grayed out in Settings, forced off regardless of saved value)
- **Live chat typing** — the streamer can type messages directly into the chat feed, labeled with their logged-in Twitch username
- **Configurable batching** — groups messages in a time window before sending to the AI; window/message-count options and the "Now" button's cooldown are gated by account tier (see below)
- **Response styles** — Auto, Chatbot, or Narrator
- **Screen question watcher** — detects trivia/quiz questions on screen (local Windows OCR + AI vision), posts them to chat for voting, and answers as co-host; currently disabled (grayed out in Settings, forced off regardless of saved value)
- **Auto-click** — clicks the chosen answer on screen via OCR, with fallbacks (first option, window center) so the game never gets stuck (inactive while the screen watcher above is disabled)
- **Auto-navigation (Majotori)** — after each round, clicks through the results screen back to the main menu and starts the next Solo Trivia round automatically (inactive while the screen watcher above is disabled)
- **YouTube peek** — periodically comments on the YouTube video open in Chrome; currently disabled (grayed out in Settings, forced off regardless of saved value)
- **YouTube song-request queue** — viewers request songs with `!sr <url|id|title>` in chat (toggle viewer requests and whether they skip the default playlist); site controls to manage the queue, auto-starts a default playlist when idle, shows the current/next-up track and title/link. Add `http://localhost:3001/overlay/video` (or your hosted domain) as an OBS browser source for the on-stream playback bar.
- **XP ranking** — every chat message earns XP (message length ÷ 10) with exponentially growing level requirements, tracked per Twitch account. Add the per-account, token-gated overlay URL shown in Settings (`/overlay/xp?token=...`) as an OBS browser source: it shows a top-5 ranking (hide with `?ranking=0`) and an animated XP bar that fades in on each gain, fills, and fades out (with a LEVEL UP flash on level-ups). Test it with `POST /xp/test`.
- **Draggable, resizable panels** — the main UI is a canvas of independent windows (chat feed, AI responses, Quick Controls, Activity Panel, etc.) you can drag, resize, collapse, and show/hide from the Panels menu; layout is saved per account
- **Onboarding tour** — a first-launch walkthrough of the UI (skipped on repeat visits), fully translated
- **i18n** — English, Español, 日本語, and 한국어, auto-detected from the browser and switchable via the language picker on the landing page and in Settings
- **Light/dark theme**
- **Bot account linking** — link your own Twitch bot account via OAuth from Settings instead of using the shared site-wide bot; the app resolves the effective bot as your linked account, falling back to the site-wide bot if none is linked
- **Guest device tunnel** — let a co-streamer run VTube Studio on a second PC and reach a VPS-hosted backend, via a downloadable tunnel client and an admin-approved device-code enrollment flow (rate-limited)
- **Accounts, tiers & admin panel** — per-user Twitch login gated by admin approval, `free`/`basic`/`advanced`/`pro` tiers controlling batching options and Now-button cooldowns (free auto-upgrades to basic after 20 all-time AI responses), an admin dashboard for managing users/tiers, and per-user AI usage tracking (response counts and estimated tokens by day/week/month/total); a frontend error logger reports uncaught client errors into the admin panel. All of this — users, tiers, usage, overlay layouts/assets, chat overlay config, Activity Panel history, XP — is persisted in a per-environment SQLite database (`backend/db.js`), not flat JSON files.

## Requirements

- [Node.js](https://nodejs.org/) 18+
- A Twitch application (Client ID + Secret) registered at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) — every deployment, including a solo local install, logs in via Twitch OAuth and requires a one-time admin approval; see [Setup](#setup)
- [Claude CLI](https://github.com/anthropics/claude-code) (`npm install -g @anthropic-ai/claude-code`), [Grok CLI](https://x.ai/), or [AGY CLI](https://antigravity.google/docs/cli) (`agy`)
- For ChatGPT: an OpenAI API key in the `OPENAI_API_KEY` environment variable (a ChatGPT subscription does not include API usage)
- A Chromium-based browser for mic transcription (Web Speech API)
- (Optional) [VTube Studio](https://denchisoft.com/) with the Plugin API enabled
- (Optional) Windows 10/11 with an OCR language pack for the screen question watcher (uses the built-in `Windows.Media.Ocr` engine via PowerShell)
- (Optional) A YouTube Data API v3 key (`YOUTUBE_API_KEY`) for song-request search/playlist support

## Setup

Every deployment sits behind Twitch OAuth login and a one-time admin approval, so a couple of one-time steps come before `npm run dev`:

1. Register an app at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) and add `http://localhost:3001/auth/twitch/callback` as an OAuth redirect URI (also add `http://localhost:3001/auth/twitch/bot-callback` if you plan to use Settings > "Connect my own bot account").
2. Set `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI` (the callback URL above), `SESSION_SECRET` (any long random string), and `ADMIN_PASSWORD` as environment variables — see the table below.

```bash
# 3. Install all dependencies
npm run install:all

# 4. Start in development mode (backend + Vite frontend + browser)
npm run dev

# Or, if you've pointed Settings > Backend URL at a remote server
# (see server/README.md), skip the local backend:
npm run dev:remote
```

The app opens at `http://localhost:5173`. The backend API runs on port `3001` by default (override with the `PORT` env var), unless `Backend URL` is set in Settings, in which case the client talks to that server instead — use `npm run dev:remote` so it doesn't also start a redundant local backend.

5. Log in with Twitch, then open `http://localhost:3001/admin` in a separate tab, sign in with `ADMIN_PASSWORD`, and approve your own account — the app shows a "waiting for approval" screen until an admin does this, even for a single local user.

For a hosted, multi-account deployment on a headless Linux VPS (with the admin panel, tiers, and the same domain serving both frontend and backend), see [`server/README.md`](server/README.md) — for example the on-demand `dev.vtamigo.top` instance.

## Building

```bash
# Build the frontend
npm run build

# Package as a Windows installer (Electron)
npm run dist:win

# Rebuild the guest tunnel client download (frontend/public/downloads/tunnel-client.exe)
npm run build:tunnel-client
```

The installer is output to `dist-electron/`.

## Configuration

All settings are available in the in-app Settings panel:

| Setting | Description |
|---|---|
| AI Provider | Locked to Claude for now ("only Claude available for now") — Grok, AGY CLI, and ChatGPT support exist in the code but aren't switchable from Settings yet |
| Twitch channel / OAuth token / Client-ID | Connect to Twitch chat and EventSub |
| Bot account | Link your own bot account via OAuth, or fall back to the shared site-wide bot |
| TikTok username | Connect to a TikTok Live chat |
| Batch window | Seconds to collect messages before sending to AI (options gated by account tier) |
| Max messages per batch | Cap on messages sent per request (gated by account tier) |
| Response style | Auto / Chatbot / Narrator |
| Base prompt | System prompt prepended to every AI request (empty by default for new users) |
| Reddit subreddits | Sources for idle-chat stories (feature currently disabled) |
| TTS provider | Windows TTS (system voices) or Piper (local offline voices from `projects/piperttsspanish`); ElevenLabs is currently disabled |
| Piper voice | Pick any `.onnx` voice installed in `piperttsspanish/voices` |
| TTS voice / speed / volume | Speech synthesis settings |
| Avatar overlay | Upload speaking/silent images and get an OBS overlay URL — no VTube Studio required |
| Chat overlay | Pick the "default" or "bubbles" theme, colors/fonts, and get an OBS overlay URL for Twitch chat |
| Overlay Builder | Design a custom OBS overlay (image/text/video/sound layers, `{token}` interpolation) at `/overlay-builder` |
| Stream title / category | Update your live Twitch title/category, or via voice command |
| Mic mode | Off / Voice to text / Commands only / Full — see Features above |
| Mic device / language / label | Voice transcription settings (Chromium-based browsers only) |
| VTube Studio URL / plugin / mouth param | Lip-sync connection settings (hidden by default; use the avatar overlay instead unless you need VTS) |
| Tunnel client | Download the guest device tunnel client for running VTube Studio from a second PC |
| Screen watcher | Scan interval, chat voting window, target process, and capture region (feature currently disabled) |
| Auto-click | Click the AI's answer or the chat's top vote |
| Auto-navigation | Click through Majotori's results screen and start the next Solo Trivia round |
| Song requests | Enable/disable viewer `!sr` requests, skip-default-on-request, manage the queue |
| Language | English, Español, 日本語, 한국어 |
| Theme | Light or dark |

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Backend server port |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | — | Credentials from your Twitch app (dev.twitch.tv/console/apps); required for Twitch login on every deployment |
| `TWITCH_REDIRECT_URI` | — | OAuth callback URL registered on that Twitch app, e.g. `http://localhost:3001/auth/twitch/callback` |
| `TWITCH_BOT_REDIRECT_URI` | — | Second registered redirect URL, used by Settings > "Connect my own bot account" |
| `SESSION_SECRET` | insecure dev default | Long random string used to sign user + admin session cookies |
| `ADMIN_PASSWORD` | — | Password for the `/admin` approval panel; `/admin/login` returns 503 until this is set |
| `APP_ENV` | falls back to `NODE_ENV`, then `development` | Selects which per-environment SQLite file the backend reads/writes (`backend/data/db/vtamigo.<env>.sqlite3`) |
| `CLAUDE_PATH` | WinGet install path | Path to the `claude.exe` binary |
| `GROK_PATH` | `C:\Users\<you>\.grok\bin\grok.exe` | Path to the `grok.exe` binary |
| `AGY_PATH` | `C:\Users\<you>\AppData\Local\agy\bin\agy.exe` | Path to the Google Antigravity `agy.exe` binary |
| `OPENAI_API_KEY` | — | API key for the ChatGPT/OpenAI provider |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Optional OpenAI model override |
| `YOUTUBE_API_KEY` | — | Optional; enables YouTube search/playlist lookup for song requests (direct URLs/IDs work without it) |
| `TWITCH_SITE_BOT_USERNAME` / `TWITCH_SITE_BOT_TOKEN` | — | Shared site-wide bot account, used when a user hasn't linked their own bot |
| `TUNNEL_HOST` | `vtamigo.top` | Hostname the guest device tunnel client connects to |
| `UMAMI_WEBSITE_ID` / `UMAMI_ENDPOINT` | project's shared Umami instance | Optional overrides for usage analytics |

See [`server/README.md`](server/README.md) for hosted-deployment-only setup (systemd service, VTube Studio reverse tunnel, etc).

## Project structure

```
AICompanion/
├── backend/          # Express API server
│   ├── index.js      # Routes
│   ├── db.js          # Central SQLite connection (per-environment DB file; see backend/data/db/)
│   ├── claude.js     # AI provider (Claude / Grok / AGY CLI) integration
│   ├── auth.js        # Twitch OAuth login + bot-account linking
│   ├── adminAuth.js   # Admin session auth + user tier management
│   ├── usage.js        # Per-user AI usage tracking (responses, estimated tokens)
│   ├── siteConfig.js   # Site-wide configuration
│   ├── errorLog.js     # Frontend error log storage, surfaced in the admin panel
│   ├── memoryExport.js       # Memory export manager across CLI models
│   ├── memoryExportWorker.js # Background worker for exporting/importing session memory
│   ├── memoryDownload.js     # Session memory download with progress reporting
│   ├── piper.js               # Piper TTS engine runner
│   ├── elevenlabs.js  # ElevenLabs TTS integration (currently disabled)
│   ├── twitch.js     # Twitch IRC client
│   ├── eventsub.js   # Twitch EventSub client
│   ├── emotes.js      # Twitch/FFZ/BTTV/7TV emote + badge resolution, used by the chat overlay
│   ├── activity.js    # Activity Panel event persistence + Twitch API backfill
│   ├── chatOverlayConfig.js  # Chat overlay appearance config (default/bubbles themes), per account
│   ├── chatOverlayBg.js      # Chat overlay background image upload/storage
│   ├── overlayLayouts.js     # Overlay Builder named layouts (layers, tokens), per account
│   ├── overlayAssets.js      # Overlay Builder per-account media library + quota
│   ├── streamSettings.js     # Twitch "Modify Channel Information" calls (Stream Settings panel + voice commands)
│   ├── userSettings.js       # Server-side sync of client Settings (temporary shim; see file header)
│   ├── tiktok.js     # TikTok Live chat client
│   ├── reddit.js     # Reddit scraper
│   ├── vtube.js      # VTube Studio WebSocket
│   ├── vtubeManager.js # Per-account VTube Studio connection management
│   ├── avatarOverlay.js # Image-swap avatar overlay (VTS alternative)
│   ├── videoQueue.js   # YouTube song-request queue state, per account
│   ├── youtube.js      # YouTube oEmbed + Data API v3 lookups
│   ├── devices.js      # Guest tunnel device-code enrollment/approval
│   ├── phonemes.js   # Phoneme-based lip-sync scheduler
│   ├── animations.js # Thinking / speaking animation states
│   ├── analytics.js  # Usage analytics
│   ├── sysmonitor.js # System resource monitoring
│   ├── xp.js           # XP ranking system
│   ├── screenwatch.js  # Screen question watcher + auto-navigation
│   ├── screenwatch.ps1 # Screen/window capture + OCR (Windows.Media.Ocr)
│   ├── screenclick.ps1 # OCR-located mouse clicks on answer options
│   └── overlay/       # OBS overlay HTML pages (avatar, video, xp)
├── frontend/         # Vite + React UI
│   └── src/
│       ├── App.jsx
│       ├── Settings.jsx
│       ├── Admin.jsx
│       ├── Login.jsx           # Landing page shown to logged-out visitors
│       ├── WindowManager.jsx / Window.jsx / PanelsMenu.jsx  # Draggable/resizable panel canvas
│       ├── ChatFeed.jsx
│       ├── ResponsePanel.jsx
│       ├── ActivityPanel.jsx
│       ├── ChatOverlayPanel.jsx / ChatOverlayPreview.jsx
│       ├── OverlayBuilder.jsx / OverlayCanvas.jsx   # Custom OBS overlay designer (/overlay-builder)
│       ├── StreamSettingsPanel.jsx
│       ├── AvatarPanel.jsx
│       ├── VideoQueue.jsx
│       ├── VoiceTranscription.js / voiceCommands.js  # Mic transcription + spoken-command parsing
│       ├── QuickControls.jsx
│       ├── OnboardingTour.jsx
│       ├── Device.jsx          # Guest tunnel device-code approval flow
│       ├── ErrorBoundary.jsx / errorLogger.js
│       ├── i18n/locales/    # en, es, ja, ko
│       └── tiers.js
├── client/           # Guest device tunnel client (packaged as a downloadable .exe)
├── server/           # Headless Linux VPS deployment scripts (see server/README.md)
└── electron/         # Electron main process
```

## License

MIT — see [LICENSE](LICENSE).
