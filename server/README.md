# Headless backend deployment (Linux)

Scripts for running the VTAmigo backend on a headless Linux VPS (tested target: Ubuntu 22.04). Only the parts of the app that don't need Windows are deployed this way — see the README's "Requirements" section for what's desktop-only (VTube Studio, screen OCR, mic transcription, Windows TTS).

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

The backend already serves the built frontend statically when running outside Electron dev mode (see `backend/index.js`'s `isProd` block), so the same domain can serve the whole app instead of running the client locally:

```bash
bash server/deploy-frontend.sh   # builds frontend/dist and restarts the service
```

Once deployed, visiting the site directly (e.g. `https://vtamigo.top`) serves the full app — no local `npm run dev`/`dev:remote` needed, and no `Backend URL` setting to configure: with it left empty, the client resolves everything (fetch + WebSocket) to whatever origin served the page, same-origin. Re-run `deploy-frontend.sh` after any `frontend/` change and `git pull`.

## VTube Studio lip-sync

VTube Studio only listens on `ws://localhost:8001` on your own PC. Once the backend runs on the VPS instead of locally, "localhost" from the backend's point of view means the VPS itself — the lip-sync connection will fail (`ECONNREFUSED 127.0.0.1:8001`) unless something bridges the two.

Fix: an SSH reverse tunnel that forwards the VPS's `localhost:8001` back to your PC's `localhost:8001`. Run this locally whenever streaming with the client pointed at the VPS:

```powershell
powershell -File server/vtube-tunnel.ps1
```

Leave the window open for the stream's duration — it auto-reconnects if the connection drops. No app config changes needed; the backend's `vtubeUrl` setting stays `ws://localhost:8001` as normal, it just now resolves through the tunnel.

This is needed regardless of how you reach the app — whether running the client locally (`npm run dev:remote`, which starts the tunnel automatically) or just opening the hosted site in a browser (in which case run `vtube-tunnel.ps1` on its own, standalone, since there's no `dev:remote` process to bundle it into). Either way, VTube Studio itself still only runs on your PC, so the tunnel is what makes the remote backend able to reach it.

## Guest tunnel client (VTube Studio from a second PC)

Anyone approved in the app can enroll a second machine's VTube Studio (e.g. a co-streamer's PC) via a downloadable client (`Settings > Tunnel client`, built from `client/tunnel-client.js` with `npm run build:tunnel-client`). It never handles the shared SSH key — it generates its own local keypair and gets approved through a device-code flow (`backend/devices.js`) at `/device?code=...`, reusing the existing Twitch login + approval.

**One-time VPS setup** — a dedicated, unprivileged SSH user that only ever does restricted port-forwarding, so a device's key can never do anything but forward its assigned port:

```bash
sudo adduser --disabled-password --gecos "" --shell /usr/sbin/nologin tunnel
sudo chmod 755 /opt/vtamigo/server/tunnel-authorized-keys.sh
sudo chown root:root /opt/vtamigo/server/tunnel-authorized-keys.sh

sudo tee -a /etc/ssh/sshd_config >/dev/null <<'EOF'

Match User tunnel
    AuthorizedKeysFile none
    AuthorizedKeysCommand /opt/vtamigo/server/tunnel-authorized-keys.sh
    AuthorizedKeysCommandUser nobody
    PasswordAuthentication no
    PubkeyAuthentication yes
    AllowTcpForwarding remote
    X11Forwarding no
    PermitTTY no
EOF
sudo sshd -t && sudo systemctl reload sshd
```

There's deliberately no `/home/tunnel/.ssh/authorized_keys` file at all — sshd instead runs `server/tunnel-authorized-keys.sh` on every connection attempt (as `AuthorizedKeysCommandUser`), which reads `backend/devices.json` and prints the matching key on the fly. This sidesteps a real footgun: a group-writable (or ACL-writable) `authorized_keys` file gets **silently ignored** by sshd's `StrictModes` — no error, it just falls back to `PasswordAuthentication`, which looks like the setup "worked" until you notice you're being asked for a password that was never supposed to exist. `AuthorizedKeysCommand` has no such permission conflict: `backend/devices.js` only ever needs to write `devices.json`, which it already owns with normal permissions — no sudo, ACLs, or shared group needed.

`AuthorizedKeysCommand` requires the script to be owned by root and not group/other-writable (`chown root:root`, `chmod 755` as above) — sshd itself refuses to run it otherwise. Each approved device in `devices.json` gets its own restricted line (`restrict,port-forwarding,permitopen="127.0.0.1:8001",permitlisten="<port>"`) generated at lookup time, with its own incrementing remote port starting at 8002 (8001 stays reserved for the owner's own `vtube-tunnel.ps1`). Revoking a device from the admin panel just flips its `status` in `devices.json` — the next connection attempt won't find it anymore.

If a client ever hits a `password:` prompt instead of connecting silently, something is misconfigured — never type a password at that prompt. Check `sudo sshd -T | grep -A6 -i 'Match User tunnel\|authorizedkeys'` reflects the block above, and `journalctl -u ssh` for `AuthorizedKeysCommand` errors.

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
