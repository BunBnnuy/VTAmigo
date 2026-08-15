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

## Dev instance (dev.vtamigo.top), on-demand only

There's a second, self-managed instance of the app running from the `dev` branch, alongside prod on the same VPS. It exists to test changes on `dev` before merging to `master` without touching the live site. Given the box only has ~1GB RAM, it's designed to stay off unless someone is actually pushing to or hitting it:

- **Repo**: `/opt/vtamigo-dev`, checked out on `dev`, port `3002` (`/etc/vtamigo-dev.env`)
- **Service**: `vtamigo-backend-dev` (systemd) — never enabled at boot, only started by the watcher below
- **nginx/TLS**: `/etc/nginx/sites-available/vtamigo-dev` → `127.0.0.1:3002`, cert via certbot for `dev.vtamigo.top`
- **Auto-deploy on push**: `/usr/local/sbin/vtamigo-dev-check-push.sh`, run every 2 min by `vtamigo-dev-push.timer`. Polls `origin/dev`; on a new commit it does `git reset --hard`, reinstalls backend/frontend deps, rebuilds the frontend, and restarts the service (which also starts it if it was stopped).
- **Auto-shutdown on idle**: `/usr/local/sbin/vtamigo-dev-check-idle.sh`, run every 15 min by `vtamigo-dev-idle.timer`. If the service is active and there's been no nginx access-log activity (nor a recent start) for 2 hours, it stops it.

So the lifecycle is: push to `dev` → live at `https://dev.vtamigo.top` within ~2 min → stops itself automatically ~2h after the last request. No manual start/stop needed in the common case; `systemctl start/stop vtamigo-backend-dev` still works directly if you want to force it either way. Backend's `PORT` is read from `process.env.PORT` (`backend/index.js`) specifically so the two instances can coexist on the same box.

## Notes

- Grok/AGY/Claude CLIs are not installed by this script — install whichever provider(s) you're using and point `CLAUDE_PATH` / `GROK_PATH` / `AGY_PATH` at their Linux binaries in `/etc/vtamigo.env`.
- `PIPER_DIR`, `PIPER_EXE`, `PIPER_VOICES_DIR`, and `PIPER_DEFAULT_VOICE` are all overridable via env — see `backend/piper.js`.
- The systemd unit caps memory at 800M (`MemoryMax`) to leave headroom for the OS on a 1GB box; adjust in `vtamigo-backend.service` before running `install-service.sh` if needed.
