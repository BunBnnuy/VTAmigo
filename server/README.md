# Headless backend deployment (Linux)

Scripts for running the VTAmigo backend on a headless Linux VPS (tested target: Ubuntu 22.04). This is how VTAmigo runs — there is no desktop build; the VPS serves both the API and the built frontend.

Two things still run in the viewer's/streamer's browser rather than on the server: mic transcription (Web Speech API, Chromium-based browsers only) and the default "Windows TTS" voice, which is really the browser's `speechSynthesis`. Piper TTS runs server-side, installed by `setup.sh`.

## Usage

```bash
git clone <your fork/repo> vtamigo
cd vtamigo
sudo bash server/setup.sh            # installs Node, backend deps, Piper, es/ voices
sudo bash server/install-service.sh  # creates a systemd service
sudo nano /etc/vtamigo.env           # fill in provider paths / API keys
sudo systemctl start vtamigo-backend
sudo journalctl -u vtamigo-backend -f
```

## What `setup.sh` does

- Installs Node.js 20.x and backend npm dependencies
- Downloads the Piper Linux binary
- Clones the `es/` folder from [AIHeaven/piper_unofficial_voices](https://huggingface.co/AIHeaven/piper_unofficial_voices) into `backend/piper/voices`

## Hosting the frontend too

The backend serves the built frontend statically in production (see the `isProd` block in `backend/app.js`), so the same domain serves the whole app:

```bash
bash server/deploy-frontend.sh   # builds frontend/dist and restarts the service
```

Once deployed, visiting the site directly (e.g. `https://vtamigo.top`) serves the full app, with no `Backend URL` setting to configure: with it left empty, the client resolves everything (fetch + WebSocket) to whatever origin served the page, same-origin. Re-run `deploy-frontend.sh` after any `frontend/` change and `git pull`.

## Dev instance (dev.vtamigo.top), edit-in-place

There's a second instance of the app running from the `dev` branch, alongside prod on the same VPS. It exists to test changes on `dev` before merging to `master` without touching the live site. Unlike prod, it's set up to be **edited directly on the box** — you change a file under `/opt/vtamigo-dev` and it's live within seconds, no commit, push, or build step:

- **Repo**: `/opt/vtamigo-dev`, checked out on `dev`, port `3002` (`/etc/vtamigo-dev.env`)
- **Service**: `vtamigo-backend-dev` (systemd), enabled at boot
- **nginx/TLS**: `/etc/nginx/sites-available/vtamigo-dev` → `127.0.0.1:3002`, cert via certbot for `dev.vtamigo.top`
- **Backend reload**: the unit is started with `node --watch` via the drop-in `/etc/systemd/system/vtamigo-backend-dev.service.d/watch.conf`, so editing anything under `backend/` restarts the process in ~1s. Open `/chat` WebSockets drop and the frontend reconnects on its own.
- **Frontend rebuild**: `vtamigo-dev-frontend-watch` (systemd) runs `vite build --watch` in `frontend/`, rewriting `frontend/dist` ~1-3s after any `frontend/src` change. The backend serves `dist` statically and re-reads per request, so a browser refresh is all that's needed — no backend restart.

There is deliberately **no auto-deploy from `origin/dev`**. An earlier `vtamigo-dev-push.timer` polled every 2 min and ran `git reset --hard`, which silently destroyed uncommitted edits on the box — incompatible with editing in place. To pick up work someone else pushed, just:

```bash
cd /opt/vtamigo-dev && git pull
```

Both watchers notice the changed files on their own, so `git pull` *is* the deploy. The one thing that no longer happens automatically is dependency installation — after a `package.json` change, run `npm ci` in `backend/` and/or `frontend/` by hand.

Reproducing the two watchers on a fresh box:

```ini
# /etc/systemd/system/vtamigo-backend-dev.service.d/watch.conf
# The empty ExecStart= clears the inherited value before setting the new one.
[Service]
ExecStart=
ExecStart=/usr/bin/node --watch index.js
```

```ini
# /etc/systemd/system/vtamigo-dev-frontend-watch.service
[Unit]
Description=VTAmigo dev frontend rebuild-on-save
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/vtamigo-dev/frontend
ExecStart=/usr/bin/node node_modules/vite/bin/vite.js build --watch
Restart=on-failure
RestartSec=5
MemoryMax=500M

[Install]
WantedBy=multi-user.target
```

The frontend watcher runs as root (matching the ownership of `frontend/`); its default umask leaves `dist` world-readable, which is all the `vtamigo` service user needs — so the `chmod -R o+rX` that `deploy-frontend.sh` does isn't required here. `MemoryMax=500M` is a safety valve: the box is 2GB and shared with prod, so a runaway build gets killed instead of letting the kernel OOM-pick the live site. For the same reason there's a 1GB `/swapfile` (in `/etc/fstab`).

Backend's `PORT` is read from `process.env.PORT` (`backend/index.js`) and the SQLite file is per-environment (`backend/db.js`, `vtamigo.<env>.sqlite3`), so the two instances coexist on the same box without sharing state.

Two cautions when working in `/opt/vtamigo-dev`:

- Don't run `git clean` there — `.claude/worktrees/` is untracked and would be deleted.
- The checkout is on `dev`. Keep it that way; the old auto-deploy used to `reset --hard origin/dev` regardless of the checked-out branch, which had quietly dragged the local `master` onto dev commits.

## Notes

- Grok/AGY/Claude CLIs are not installed by this script — install whichever provider(s) you're using and point `CLAUDE_PATH` / `GROK_PATH` / `AGY_PATH` at their Linux binaries in `/etc/vtamigo.env`.
- `PIPER_DIR`, `PIPER_EXE`, `PIPER_VOICES_DIR`, and `PIPER_DEFAULT_VOICE` are all overridable via env — see `backend/piper.js`.
- The systemd unit caps memory at 800M (`MemoryMax`) to leave headroom for the OS on a 1GB box; adjust in `vtamigo-backend.service` before running `install-service.sh` if needed.
