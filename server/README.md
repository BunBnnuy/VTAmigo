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

Once deployed, visiting the site directly (e.g. `https://93130123.xyz`) serves the full app — no local `npm run dev`/`dev:remote` needed, and no `Backend URL` setting to configure: with it left empty, the client resolves everything (fetch + WebSocket) to whatever origin served the page, same-origin. Re-run `deploy-frontend.sh` after any `frontend/` change and `git pull`.

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
apt install -y acl   # provides setfacl/getfacl, if not already present
sudo adduser --disabled-password --gecos "" --shell /usr/sbin/nologin tunnel
sudo -u tunnel mkdir -p /home/tunnel/.ssh
sudo touch /home/tunnel/.ssh/authorized_keys
sudo chown -R tunnel:tunnel /home/tunnel/.ssh
sudo chmod 700 /home/tunnel/.ssh
sudo chmod 600 /home/tunnel/.ssh/authorized_keys
# Grant vtamigo read/write via ACL rather than group-writable bits — sshd's
# StrictModes silently ignores an authorized_keys file that's writable by
# group/other, which took real debugging to catch (it falls back to
# PasswordAuthentication instead of erroring, which looks like it's "working"
# until you notice you're being asked for a password that doesn't exist).
sudo setfacl -m u:vtamigo:rx /home/tunnel/.ssh
sudo setfacl -m u:vtamigo:rw /home/tunnel/.ssh/authorized_keys

# Also disable password auth for this account specifically, and restrict it
# to remote port-forwarding only (defense in depth beyond the authorized_keys
# `restrict` option on each individual key):
sudo tee -a /etc/ssh/sshd_config >/dev/null <<'EOF'

Match User tunnel
    PasswordAuthentication no
    PubkeyAuthentication yes
    AllowTcpForwarding remote
    X11Forwarding no
    PermitTTY no
EOF
sudo sshd -t && sudo systemctl reload sshd
```

`backend/devices.js` writes to `/home/tunnel/.ssh/authorized_keys` directly (override the path with `TUNNEL_AUTHORIZED_KEYS` in `/etc/vtamigo.env` if needed) — no sudo/root access required by the backend process, just the ACL grant above. Each approved device gets its own restricted line (`restrict,port-forwarding,permitopen="127.0.0.1:8001",permitlisten="<port>"`) and its own incrementing remote port starting at 8002 (8001 stays reserved for the owner's own `vtube-tunnel.ps1`). Revoking a device from the admin panel removes only its line.

If a client hits a `password:` prompt instead of connecting silently, that's the signal something's wrong with the ACL/permissions above (or the device's key never made it into `authorized_keys` — check `journalctl -u vtamigo-backend` for `[devices] could not write authorized_keys` warnings). Never type a password at that prompt; fix the permissions instead.

## Notes

- Grok/AGY/Claude CLIs are not installed by this script — install whichever provider(s) you're using and point `CLAUDE_PATH` / `GROK_PATH` / `AGY_PATH` at their Linux binaries in `/etc/vtamigo.env`.
- `PIPER_DIR`, `PIPER_EXE`, `PIPER_VOICES_DIR`, and `PIPER_DEFAULT_VOICE` are all overridable via env — see `backend/piper.js`.
- The systemd unit caps memory at 800M (`MemoryMax`) to leave headroom for the OS on a 1GB box; adjust in `vtamigo-backend.service` before running `install-service.sh` if needed.
