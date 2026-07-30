#!/usr/bin/env bash
# Rebuilds the frontend and restarts the backend so it picks up the new
# static build. Run on the VPS after `git pull` when frontend/ changed.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Building frontend"
cd "$REPO_DIR/frontend"
npm install
npm run build

echo "==> Fixing permissions for the vtamigo service user"
chmod -R o+rX "$REPO_DIR/frontend/dist" "$REPO_DIR/frontend"

echo "==> Restarting backend"
systemctl restart vtamigo-backend

echo "==> Done. Serving at whatever domain nginx/vtamigo-backend is configured for."
