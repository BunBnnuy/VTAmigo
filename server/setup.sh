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
# SHA256 of piper_linux_x86_64.tar.gz for $PIPER_VERSION, computed from the
# release asset (upstream publishes no checksum file, so this was captured
# from a verified download on 2026-09-18). Bump together with PIPER_VERSION:
# download the new asset once, verify it out-of-band, update this hash.
PIPER_SHA256="a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992"

echo "==> Installing system packages"
apt-get update -y
apt-get install -y curl git git-lfs build-essential ca-certificates gnupg

echo "==> Installing Node.js 20.x"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  # Pinned-apt-source install instead of `curl ... | bash`: the old
  # setup_20.x pipe executed whatever the CDN returned at install time with
  # no integrity check. This adds the NodeSource keyring + repo entry
  # directly (the documented nodesource/distributions method), so apt's
  # signed-Release verification covers every package from then on.
  NODE_MAJOR=20
  NODESOURCE_KEYRING=/usr/share/keyrings/nodesource.gpg
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o "$NODESOURCE_KEYRING"
  echo "deb [signed-by=$NODESOURCE_KEYRING] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" \
    | tee /etc/apt/sources.list.d/nodesource.list > /dev/null
  apt-get update -y
  apt-get install -y nodejs
else
  echo "Node $(node -v) already installed, skipping"
fi

echo "==> Installing backend dependencies"
cd "$BACKEND_DIR"
npm ci --omit=dev

echo "==> Installing Piper TTS binary"
mkdir -p "$PIPER_DIR"
if [ ! -x "$PIPER_DIR/piper/piper" ]; then
  TMP_DIR="$(mktemp -d)"
  curl -fsSL -o "$TMP_DIR/$PIPER_ARCHIVE" \
    "https://github.com/rhasspy/piper/releases/download/$PIPER_VERSION/$PIPER_ARCHIVE"
  # Fail closed on a tampered or half-downloaded tarball — never extract first
  # and ask questions later.
  echo "$PIPER_SHA256  $TMP_DIR/$PIPER_ARCHIVE" | sha256sum -c -
  tar -xzf "$TMP_DIR/$PIPER_ARCHIVE" -C "$PIPER_DIR"
  rm -rf "$TMP_DIR"
  chmod +x "$PIPER_DIR/piper/piper"
else
  echo "Piper binary already present, skipping"
fi

echo "==> Fetching Spanish voices (AIHeaven/piper_unofficial_voices, es/ only)"
mkdir -p "$PIPER_DIR/voices"
VOICES_TMP="$(mktemp -d)"
# Reviewed commit of AIHeaven/piper_unofficial_voices (main @ 2024-11-19,
# "Add user voice"). Re-pin deliberately after reviewing the diff — never to
# a moving branch tip, or a force-pushed upstream could slip new blobs in.
VOICES_PINNED_SHA="8d2cf13608845e97e18915df2544a96cd9beafcb"
git lfs install --skip-repo
# HF's git server doesn't play well with --filter/--sparse partial clones
# (fails with "error reading section header"), so clone the whole repo
# instead — it's small until LFS objects are pulled (SKIP_SMUDGE below).
GIT_LFS_SKIP_SMUDGE=1 git clone --single-branch \
  https://huggingface.co/AIHeaven/piper_unofficial_voices "$VOICES_TMP/repo"
cd "$VOICES_TMP/repo"
# Detached checkout of the reviewed commit, then verify it took — fails
# closed if upstream rewrote history and the SHA is gone or moved.
git checkout "$VOICES_PINNED_SHA"
[ "$(git rev-parse HEAD)" = "$VOICES_PINNED_SHA" ]
git lfs pull --include "es/*.tar.gz"
# Verify every downloaded LFS object against its pointer OID, and log the
# OIDs so a future audit can compare them against the pinned commit.
git lfs fsck
git lfs ls-files --long
# Each voice ships as a tar.gz containing a flat *.onnx + *.onnx.json pair.
for archive in es/*.tar.gz; do
  tar -xzf "$archive" -C "$PIPER_DIR/voices"
done
cd "$REPO_DIR"
rm -rf "$VOICES_TMP"

VOICE_COUNT=$(find "$PIPER_DIR/voices" -name '*.onnx' | wc -l)
echo "==> Installed $VOICE_COUNT voice(s) into $PIPER_DIR/voices"

echo ""
echo "==> Done. Next steps:"
echo "  1. Copy server/vtamigo.env.example to /etc/vtamigo.env and fill in your values"
echo "     (CLAUDE_PATH/GROK_PATH/AGY_PATH, provider API keys, PIPER_DEFAULT_VOICE, ...)"
echo "  2. Install the systemd service: sudo bash server/install-service.sh"
echo "  3. Check voice filenames with: ls $PIPER_DIR/voices"
