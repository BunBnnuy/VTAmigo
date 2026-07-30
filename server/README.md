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

## Notes

- Grok/AGY/Claude CLIs are not installed by this script — install whichever provider(s) you're using and point `CLAUDE_PATH` / `GROK_PATH` / `AGY_PATH` at their Linux binaries in `/etc/vtamigo.env`.
- `PIPER_DIR`, `PIPER_EXE`, `PIPER_VOICES_DIR`, and `PIPER_DEFAULT_VOICE` are all overridable via env — see `backend/piper.js`.
- The systemd unit caps memory at 800M (`MemoryMax`) to leave headroom for the OS on a 1GB box; adjust in `vtamigo-backend.service` before running `install-service.sh` if needed.
