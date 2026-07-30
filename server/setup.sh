#!/usr/bin/env bash
# VTAmigo headless backend setup — Ubuntu 22.04
#
# Installs Node.js, backend deps, Piper TTS, and the Spanish voices from
# https://huggingface.co/AIHeaven/piper_unofficial_voices (es/ folder).
#
# Run from the repo root: sudo bash server/setup.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo bash server/setup.sh)" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_DIR/backend"
PIPER_DIR="$BACKEND_DIR/piper"
PIPER_VERSION="2023.11.14-2"
PIPER_ARCHIVE="piper_linux_x86_64.tar.gz"

echo "==> Installing system packages"
apt-get update -y
apt-get install -y curl git git-lfs build-essential ca-certificates

echo "==> Installing Node.js 20.x"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  echo "Node $(node -v) already installed, skipping"
fi

echo "==> Installing backend dependencies"
cd "$BACKEND_DIR"
npm install --omit=dev

echo "==> Installing Piper TTS binary"
mkdir -p "$PIPER_DIR"
if [ ! -x "$PIPER_DIR/piper/piper" ]; then
  TMP_DIR="$(mktemp -d)"
  curl -fsSL -o "$TMP_DIR/$PIPER_ARCHIVE" \
    "https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/$PIPER_ARCHIVE"
  tar -xzf "$TMP_DIR/$PIPER_ARCHIVE" -C "$PIPER_DIR"
  rm -rf "$TMP_DIR"
  chmod +x "$PIPER_DIR/piper/piper"
else
  echo "Piper binary already present, skipping"
fi

echo "==> Fetching Spanish voices (AIHeaven/piper_unofficial_voices, es/ only)"
mkdir -p "$PIPER_DIR/voices"
VOICES_TMP="$(mktemp -d)"
git lfs install --skip-repo
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --filter=blob:none --sparse \
  https://huggingface.co/AIHeaven/piper_unofficial_voices "$VOICES_TMP/repo"
cd "$VOICES_TMP/repo"
git sparse-checkout set es
git lfs pull --include "es/*"
cp -v es/*.onnx es/*.onnx.json "$PIPER_DIR/voices/" 2>/dev/null || true
cd "$REPO_DIR"
rm -rf "$VOICES_TMP"

VOICE_COUNT=$(find "$PIPER_DIR/voices" -name '*.onnx' | wc -l)
echo "==> Installed $VOICE_COUNT voice(s) into $PIPER_DIR/voices"

echo ""
echo "==> Done. Next steps:"
echo "  1. Copy server/vtamigo.env.example to /etc/vtamigo.env and fill in your values"
echo "     (CLAUDE_PATH/GROK_PATH/AGY_PATH, OPENAI_API_KEY, ELEVENLABS_API_KEY, PIPER_DEFAULT_VOICE, ...)"
echo "  2. Install the systemd service: sudo bash server/install-service.sh"
echo "  3. Check voice filenames with: ls $PIPER_DIR/voices"
