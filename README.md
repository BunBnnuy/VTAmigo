# VTAmigo

An AI co-host companion for Twitch and TikTok Live streams. It reads chat in real time, batches messages, and generates spoken responses using your choice of AI provider, driving an image-swap avatar overlay for OBS.

VTAmigo is a hosted, multi-account web app (see [`server/README.md`](server/README.md)) with per-user accounts, tiers, and an admin panel. Twitch OAuth creates an active Free-tier account immediately — see [Setup](#setup).

## Features

- **Twitch & TikTok Live** chat reading
- **AI responses** via Claude CLI — the same code path also supports Grok CLI, AGY CLI, and ChatGPT (OpenAI API), but the provider picker in Settings is currently locked to Claude ("only Claude available for now") while the others are finished
- **Persistent memory & Session Export** — Claude, Grok, and AGY CLI each keep a long-lived CLI session (resumed across restarts) so the co-host remembers past conversations. Export session memory between providers (e.g. Grok -> AGY) from Settings. Delete `backend/.agent-sessions.json` to reset.
- **Text-to-Speech** with configurable voice, speed, and volume — "Windows TTS" (the default: the browser's built-in `speechSynthesis`, free, whatever voices the viewer's OS provides) or Piper (local offline Spanish voices, CPU-only, running on the server). Piper clips drive the avatar with their real audio duration and fall back to browser TTS if generation fails.
- **Avatar overlay** — upload speaking/silent images (JPEG/PNG/GIF/WebP, 5MB max) and add an OBS browser source that swaps between them while the co-host talks
- **Chat overlay** — a Twitch-chat OBS browser source with two themes: a "default" nine-slice-background renderer, or "bubbles", a decorated speech-bubble theme (emote/badge rendering, custom flower ornaments, per-event alert copy). Both themes share message limits, fade timing, colors/fonts, and bot-message filtering, all configured from the Chat Overlay panel.
- **Custom Overlay Builder** — a freeform OBS overlay designer at `/overlay-builder`: a 1920x1080 canvas with image, text, video, and sound layers (HSB filters on images; autoplay/loop/trigger options on video and sound); text layers support `{token}` interpolation for live Twitch event data (e.g. `{follower.username}`, `{cheer.bits}`). Save multiple named layouts per account, each with its own OBS URL, backed by a per-account media library with per-file-type size caps and a 100MB total quota.
- **Activity Panel** — a persisted feed of follows, subs, resubs, gift subs, raids, and cheers; backfilled from Twitch's API on first connect and stored server-side, so it survives page reloads
- **Twitch EventSub** — reacts to follows, subs, raids, cheers, and channel point redeems; also what feeds the Activity Panel and the Overlay Builder's live `{token}` data
- **Stream Settings panel** — change your live Twitch title and category from the site (with category search/autocomplete), or hands-free via voice commands
- **Voice control & commands** — a 4-way mic mode in Settings/Quick Controls: **Off** (mic disabled), **Voice to text** (transcribes your mic into the AI's context, shown in the chat feed), **Commands only** (nothing added to chat — only spoken commands like "change the title to ..." are acted on), or **Full** (both). Commands only cover changing your live Twitch title/category so far. Chromium-based browsers only (Web Speech API).
- **Live chat typing** — type messages directly into the chat feed, labeled with your logged-in Twitch username
- **Configurable batching** — groups messages in a time window before sending to the AI; window/message-count options and the "Now" button's cooldown are gated by account tier
- **Response styles** — Auto, Chatbot, or Narrator
- **YouTube song-request queue** — viewers request songs with `!sr <url|id|title>` in chat (toggle viewer requests and whether they skip the default playlist); site controls to manage the queue, auto-starts a default playlist when idle, shows the current/next-up track and title/link. Add `/overlay/video` as an OBS browser source for the on-stream playback bar.
- **XP ranking** — every chat message earns XP (message length ÷ 10) with exponentially growing level requirements, tracked per Twitch account. Add the per-account, token-gated overlay URL shown in Settings (`/overlay/xp?token=...`) as an OBS browser source: it shows a top-5 ranking (hide with `?ranking=0`) and an animated XP bar that fades in on each gain, fills, and fades out (with a LEVEL UP flash on level-ups). Test it with `POST /xp/test`.
- **Draggable, resizable panels** — the main UI is a canvas of independent windows (chat feed, AI responses, Quick Controls, Activity Panel, etc.) you can drag, resize, collapse, and show/hide from the Panels menu; layout is saved per account
- **Onboarding tour** — a first-launch walkthrough of the UI (skipped on repeat visits), fully translated
- **i18n** — English, Español, 日本語, and 한국어, auto-detected from the browser and switchable from the landing page and Settings. English is the reference locale and the fallback; es/ja/ko have some known gaps, documented in `frontend/test/i18nParity.test.js`.
- **Light/dark theme**
- **Bot account linking** — link your own Twitch bot account via OAuth from Settings instead of using the shared site-wide bot; the app resolves the effective bot as your linked account, falling back to the site-wide bot if none is linked
- **Accounts, tiers & admin panel** — Twitch OAuth activates each new account on the `free` tier; `free`/`basic`/`advanced`/`pro` tiers control batching options and Now-button cooldowns (free auto-upgrades to basic after 20 all-time AI responses). The admin dashboard can manage access and tiers and shows per-user AI usage (response counts and estimated tokens by day/week/month/total); a frontend error logger reports uncaught client errors into the admin panel. All of this — users, tiers, usage, overlay layouts/assets, chat overlay config, Activity Panel history, XP — is persisted in a per-environment SQLite database (`backend/db.js`), not flat JSON files.

## Requirements

- [Node.js](https://nodejs.org/) 18+
- A Twitch application (Client ID + Secret) registered at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps); see [Setup](#setup)
- [Claude CLI](https://github.com/anthropics/claude-code) (`npm install -g @anthropic-ai/claude-code`), [Grok CLI](https://x.ai/), or [AGY CLI](https://antigravity.google/docs/cli) (`agy`)
- For ChatGPT: an OpenAI API key in the `OPENAI_API_KEY` environment variable (a ChatGPT subscription does not include API usage)
- A Chromium-based browser for mic transcription (Web Speech API)
- (Optional) A YouTube Data API v3 key (`YOUTUBE_API_KEY`) for song-request search/playlist support

## Setup

Every deployment uses Twitch OAuth login, so complete these steps before `npm run dev`:

1. Register an app at [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) and add `http://localhost:3001/auth/twitch/callback` as an OAuth redirect URI (also add `http://localhost:3001/auth/twitch/bot-callback` if you plan to use Settings > "Connect my own bot account").
2. Set `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI` (the callback URL above), `SESSION_SECRET` (any long random string), and `ADMIN_PASSWORD` as environment variables — see the table below.

```bash
# 3. Install all dependencies
npm run install:all

# 4. Start in development mode (backend + Vite dev server)
npm run dev
```

`npm run dev` starts the backend on port `3001` (override with `PORT`) and Vite on `http://localhost:5173`, and asks Vite to open your default browser there. Vite proxies the backend's API routes through to it — see the `proxy` block in `frontend/vite.config.js`.

5. Log in with Twitch. The app creates your active account on the Free tier and opens the dashboard immediately. Use `http://localhost:3001/admin` only when you need to change access or tiers.

That is the development loop. For the real deployment — a headless Linux VPS serving both the frontend and the API from one domain, with systemd, nginx, and the admin panel — see [`server/README.md`](server/README.md). Deploys to it run over SSH from `.github/workflows/deploy.yml` on every push to `master`.

## Building

```bash
npm run build   # builds the frontend into frontend/dist
```

`server/deploy-frontend.sh` runs this on the VPS; the backend then serves `frontend/dist` statically.

## Testing

```bash
npm test                      # backend + frontend
npm --prefix backend test     # Vitest + supertest against backend/app.js (APP_ENV=test)
npm --prefix frontend test    # Vitest + jsdom + Testing Library
```

The backend suite runs against `backend/data/db/vtamigo.test.sqlite3`, kept separate from the development database. `.github/workflows/ci.yml` runs both suites plus a frontend build on every push and pull request.

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
| TTS provider | "Windows TTS" (the browser's own `speechSynthesis` voices) or Piper (local offline voices installed by `server/setup.sh`) |
| Piper voice | Pick any `.onnx` voice installed under `backend/piper/voices` |
| TTS voice / speed / volume | Speech synthesis settings |
| Avatar overlay | Upload speaking/silent images and get an OBS overlay URL |
| Chat overlay | Pick the "default" or "bubbles" theme, colors/fonts, and get an OBS overlay URL for Twitch chat |
| Overlay Builder | Design a custom OBS overlay (image/text/video/sound layers, `{token}` interpolation) at `/overlay-builder` |
| Stream title / category | Update your live Twitch title/category, or via voice command |
| Mic mode | Off / Voice to text / Commands only / Full — see Features above |
| Mic device / language / label | Voice transcription settings (Chromium-based browsers only) |
| Song requests | Enable/disable viewer `!sr` requests, skip-default-on-request, manage the queue |
| Ignored users | Chat usernames whose messages are dropped before they reach the AI |
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
| `ADMIN_PASSWORD` | — | Password for the `/admin` access and tier panel; `/admin/login` returns 503 until this is set |
| `APP_ENV` | falls back to `NODE_ENV`, then `development` | Selects which per-environment SQLite file the backend reads/writes (`backend/data/db/vtamigo.<env>.sqlite3`) |
| `CLAUDE_PATH` | WinGet install path | Path to the `claude` binary |
| `GROK_PATH` | `C:\Users\<you>\.grok\bin\grok.exe` | Path to the `grok` binary |
| `AGY_PATH` | `C:\Users\<you>\AppData\Local\agy\bin\agy.exe` | Path to the Google Antigravity `agy` binary |
| `OPENAI_API_KEY` | — | API key for the ChatGPT/OpenAI provider |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Optional OpenAI model override |
| `YOUTUBE_API_KEY` | — | Optional; enables YouTube search/playlist lookup for song requests (direct URLs/IDs work without it) |
| `TWITCH_SITE_BOT_USERNAME` / `TWITCH_SITE_BOT_TOKEN` | — | Shared site-wide bot account, used when a user hasn't linked their own bot |
| `UMAMI_WEBSITE_ID` / `UMAMI_ENDPOINT` | project's shared Umami instance | Optional overrides for usage analytics |

The three CLI path defaults are Windows paths left over from the desktop era; on the Linux VPS they are always set explicitly in `/etc/vtamigo.env`. See [`server/README.md`](server/README.md) for hosted-deployment setup (systemd service, firewall, dev instance).

## Project structure

```
VTAmigo/
├── backend/          # Express API server
│   ├── app.js         # The app itself: routes, WebSocket server, middleware — exported, not started
│   ├── index.js       # Process entry point: background timers, listen(), fatal-error handling
│   ├── db.js          # Central SQLite connection (per-environment DB file; see backend/data/db/)
│   ├── claude.js      # AI provider (Claude / Grok / AGY CLI / OpenAI) integration
│   ├── auth.js        # Twitch OAuth login + bot-account linking
│   ├── adminAuth.js   # Admin session auth + user tier management
│   ├── usage.js       # Per-user AI usage tracking (responses, estimated tokens)
│   ├── siteConfig.js  # Site-wide configuration
│   ├── errorLog.js    # Frontend error log storage, surfaced in the admin panel
│   ├── memoryExport.js       # Memory export manager across CLI models
│   ├── memoryExportWorker.js # Background worker for exporting/importing session memory
│   ├── memoryDownload.js     # Session memory download with progress reporting
│   ├── piper.js       # Piper TTS engine runner
│   ├── twitch.js      # Twitch IRC client
│   ├── eventsub.js    # Twitch EventSub client
│   ├── emotes.js      # Twitch/FFZ/BTTV/7TV emote + badge resolution, used by the chat overlay
│   ├── activity.js    # Activity Panel event persistence + Twitch API backfill
│   ├── chatOverlayConfig.js  # Chat overlay appearance config (default/bubbles themes), per account
│   ├── chatOverlayBg.js      # Chat overlay background image upload/storage
│   ├── overlayLayouts.js     # Overlay Builder named layouts (layers, tokens), per account
│   ├── overlayAssets.js      # Overlay Builder per-account media library + quota
│   ├── streamSettings.js     # Twitch "Modify Channel Information" calls (Stream Settings + voice commands)
│   ├── userSettings.js       # Server-side sync of client Settings (temporary shim; see file header)
│   ├── tiktok.js      # TikTok Live chat client
│   ├── avatarOverlay.js # Image-swap avatar overlay state
│   ├── videoQueue.js  # YouTube song-request queue state, per account
│   ├── youtube.js     # YouTube oEmbed + Data API v3 lookups (song requests)
│   ├── analytics.js   # Usage analytics
│   ├── sysmonitor.js  # System resource monitoring
│   ├── xp.js          # XP ranking system
│   ├── migrate-to-sqlite.js  # One-shot import of legacy JSON data into SQLite
│   ├── overlay/       # OBS overlay HTML pages (avatar, chat, custom, video, xp)
│   └── test/          # Vitest + supertest suites
├── frontend/         # Vite + React UI
│   ├── src/
│   │   ├── App.jsx
│   │   ├── Settings.jsx
│   │   ├── Admin.jsx
│   │   ├── Login.jsx / Faq.jsx / PrivacyPolicy.jsx / Pending.jsx / NotFound.jsx
│   │   ├── WindowManager.jsx / Window.jsx / PanelsMenu.jsx  # Draggable/resizable panel canvas
│   │   ├── ChatFeed.jsx
│   │   ├── ResponsePanel.jsx
│   │   ├── ActivityPanel.jsx
│   │   ├── ChatOverlayPanel.jsx / ChatOverlayPreview.jsx
│   │   ├── OverlayBuilder.jsx / OverlayCanvas.jsx   # Custom OBS overlay designer (/overlay-builder)
│   │   ├── StreamSettingsPanel.jsx
│   │   ├── AvatarPanel.jsx
│   │   ├── VideoQueue.jsx
│   │   ├── VoiceTranscription.js / voiceCommands.js  # Mic transcription + spoken-command parsing
│   │   ├── TTSController.js
│   │   ├── QuickControls.jsx
│   │   ├── OnboardingTour.jsx
│   │   ├── ErrorBoundary.jsx / errorLogger.js
│   │   ├── i18n/locales/    # en, es, ja, ko
│   │   └── tiers.js
│   ├── test/         # Vitest + jsdom + Testing Library suites
│   └── DESIGN.md     # Source of truth for colors, fonts, and window chrome
└── server/           # Linux VPS deployment scripts (see server/README.md)
```

## License

MIT — see [LICENSE](LICENSE).
