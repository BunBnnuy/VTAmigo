# MEMORIES.md — working notes on this project

Orientation notes for anyone (human or agent) picking up VTAmigo. Feature-level
detail lives in `README.md`, deployment detail in `server/README.md`, visual
tokens in `frontend/DESIGN.md`; this file records how the pieces fit together
and how work actually flows.

## What it is

VTAmigo is an AI co-host for Twitch/TikTok Live streams: it reads chat,
batches messages, generates spoken replies, and drives an avatar (VTube Studio
lip-sync or a simple speaking/silent image swap) plus a set of OBS overlays.

It ships two ways from the same `frontend/` + `backend/` code:

- **Local Electron app** (`electron/main.js`, `npm run dist:win`).
- **Hosted multi-account web app** on a VPS, with Twitch OAuth login, admin
  approval, per-user tiers, and an admin panel.

## Repo layout

| Path | What lives there |
|---|---|
| `backend/` | Express + `ws` server, one module per feature (`eventsub.js`, `claude.js`, `piper.js`, `overlayLayouts.js`, `activity.js`, …). Entry: `backend/index.js`, port from `process.env.PORT`. |
| `backend/db.js` | SQLite persistence, per-environment file (`vtamigo.<env>.sqlite3`). Users, tiers, usage, overlay layouts/assets, chat-overlay config, Activity Panel history, XP. Replaced the old flat-JSON storage (`migrate-to-sqlite.js` is the one-off migration). |
| `frontend/` | Vite + React. Flat `src/` — one file per panel/page, no deep component tree. |
| `server/` | VPS provisioning + deploy scripts, systemd units, tunnel helpers, and `server/README.md` (the ops source of truth). |
| `client/` | `tunnel-client.js` — the guest-device tunnel, packaged to an `.exe` via `npm run build:tunnel-client`. |
| `electron/` | Desktop wrapper only. |

The frontend UI is a canvas of draggable/resizable windows (`Window.jsx`,
`WindowManager.jsx`, `PanelsMenu.jsx`); layout is saved per account.

## Conventions worth keeping

- **Never hardcode colors in `frontend/src/**`.** Use the CSS custom
  properties in `frontend/src/index.css`, and keep `frontend/DESIGN.md` in
  sync when a design decision changes (this is also in `CLAUDE.md`).
  Typography: Quicksand for headings/buttons/labels, Nunito for body.
- Icons are flat `lucide-react` icons — emoji were deliberately removed.
- User-facing strings go through i18n (`frontend/src/i18n`): en, es, ja, ko.
- Several features are intentionally **shipped but disabled** in Settings —
  Reddit stories, screen question watcher (+ auto-click, Majotori
  auto-navigation), YouTube peek, ElevenLabs TTS, and the non-Claude AI
  providers. The code paths are finished; the UI forces them off. Don't
  "fix" them by re-enabling without asking.

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
AI responses go through the Claude CLI as a child process (Grok/AGY/ChatGPT
paths exist but are locked off). TTS is Windows TTS or local Piper.
