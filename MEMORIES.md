# MEMORIES.md — working notes on this project

Orientation notes for anyone (human or agent) picking up VTAmigo. Feature-level
detail lives in `README.md`, deployment detail in `server/README.md`, visual
tokens in `frontend/DESIGN.md`; this file records how the pieces fit together
and how work actually flows.

## What it is

VTAmigo is an AI co-host for Twitch/TikTok Live streams: it reads chat,
batches messages, generates spoken replies, and drives a speaking/silent avatar
image swap plus a set of OBS overlays.

It ships **one** way: a hosted multi-account web app on a VPS, with Twitch OAuth
login, admin approval, per-user tiers, and an admin panel.

It began as a single-streamer Electron desktop app for Windows, and for a long
time carried the leftovers of that: the Electron packaging, a device tunnel that
bridged VTube Studio on a second PC, PowerShell screen-OCR scripts, and four
features shipped-but-disabled in Settings. All of that has been removed — see
`REFACTOR_STATUS.md` for what went and what is still in flight. If a file or doc
still implies a desktop build exists, it is stale; fix it.

## Repo layout

| Path | What lives there |
|---|---|
| `backend/app.js` | Builds the Express app and wires every route, but never listens. Exports `{ app, server, wss, startBackgroundJobs, PORT }`. |
| `backend/index.js` | Process entry point only: starts background timers, calls `listen()`, handles fatal errors. The split is what lets tests drive the app with supertest without binding a port. |
| `backend/` | One module per feature (`eventsub.js`, `claude.js`, `piper.js`, `overlayLayouts.js`, `activity.js`, …). Port from `process.env.PORT`. |
| `backend/db.js` | SQLite persistence, per-environment file (`vtamigo.<env>.sqlite3`). Users, tiers, usage, overlay layouts/assets, chat-overlay config, Activity Panel history, XP. |
| `backend/test/`, `frontend/test/` | Vitest suites. Backend uses supertest and runs against `APP_ENV=test`; frontend uses jsdom + Testing Library. |
| `frontend/` | Vite + React. Flat `src/` — one file per panel/page, no deep component tree. |
| `server/` | VPS provisioning + deploy scripts, systemd units, and `server/README.md` (the ops source of truth). |

The frontend UI is a canvas of draggable/resizable windows (`Window.jsx`,
`WindowManager.jsx`, `PanelsMenu.jsx`); layout is saved per account.

## Conventions worth keeping

- **Never hardcode colors in `frontend/src/**`.** Use the CSS custom
  properties in `frontend/src/index.css`, and keep `frontend/DESIGN.md` in
  sync when a design decision changes (this is also in `CLAUDE.md`).
  Typography: Quicksand for headings/buttons/labels, Nunito for body.
- Icons are flat `lucide-react` icons — emoji were deliberately removed.
- User-facing strings go through i18n (`frontend/src/i18n`): en, es, ja, ko.
- The features that used to be **shipped but disabled** are now **gone**:
  Reddit stories, the screen question watcher (+ auto-click and Majotori
  auto-navigation), YouTube peek, ElevenLabs TTS, VTube Studio lip-sync and
  the guest device tunnel. Code, routes, settings keys, i18n and docs all
  went with them. Don't reintroduce one without a deliberate decision.
- The four **AI providers are all real** (Claude, Grok, AGY, ChatGPT) and the
  Settings picker is no longer locked to Claude.
- **Tests are not optional any more.** `npm test` runs both packages; CI runs
  them plus the frontend build on every push and PR, and fails on any `high`
  or `critical` npm advisory in either package.

## Environments and how work flows

Two instances share one ~2GB VPS, so memory discipline matters.

- **prod** — `master`, `https://vtamigo.top`. Deployed by GitHub Actions
  (`.github/workflows/deploy.yml`) on push to `master`.
- **dev/staging** — `dev`, `https://dev.vtamigo.top`, checkout at
  `/opt/vtamigo-dev`, port 3002. **Edit-in-place**: the backend runs under
  `node --watch` and the frontend under `vite build --watch`, so a changed
  file is live in seconds — no commit, push, or manual build. Staging is
  blocked from search engines via `X-Robots-Tag`.

There is deliberately **no auto-deploy from `origin/dev`** any more; the old
polling timer ran `git reset --hard` and destroyed in-place edits. To pick up
someone else's work: `cd /opt/vtamigo-dev && git pull` — the watchers do the
rest. Dependencies are the exception: after a `package.json` change, run
`npm ci` in `backend/` and/or `frontend/` by hand.

Feature work happens in git worktrees under
`/opt/vtamigo-dev/.claude/worktrees/<name>` on `claude/<name>` branches. The
cycle is: commit on the branch → merge into `dev` in the `/opt/vtamigo-dev`
checkout → push `origin dev`. No service restart needed. `dev` is merged into
`master` when a batch of changes is ready.

Cautions in `/opt/vtamigo-dev`:

- **Don't run `git clean`** there — `.claude/worktrees/` is untracked and
  would be wiped.
- Keep the checkout on `dev`. The old auto-deploy used to reset hard
  regardless of the checked-out branch, which once dragged local `master`
  onto dev commits.
- Runtime user data (uploaded media, SQLite files) is gitignored — don't
  commit it. A 4.4 MB `logo.png` was already once shrunk to 71 KB; keep
  committed assets small.

## External dependencies

Twitch app credentials (OAuth + EventSub), and env vars in
`/etc/vtamigo.env` / `/etc/vtamigo-dev.env` — `TWITCH_CLIENT_ID`,
`TWITCH_CLIENT_SECRET`, `TWITCH_REDIRECT_URI`, `SESSION_SECRET`,
`ADMIN_PASSWORD`, optional `YOUTUBE_API_KEY` and `OPENAI_API_KEY`.
AI responses go through a provider CLI as a child process — Claude, Grok or AGY —
or the OpenAI HTTP API for ChatGPT; all four are selectable. TTS is the
browser's own `speechSynthesis` (labelled "Windows TTS") or local Piper.

`SESSION_SECRET` deserves care: the user session JWTs, the admin JWTs, the
AES-256-GCM key that encrypts Twitch tokens at rest, and the overlay-token HMAC
are all derived from it. Losing or changing it logs everyone out and makes
already-encrypted Twitch tokens unreadable, forcing a re-login.
