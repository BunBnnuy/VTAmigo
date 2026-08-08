#!/usr/bin/env bash
# Rebuilds the frontend, installs/updates backend dependencies (including
# native modules like better-sqlite3), and restarts the backend so it picks
# up the new static build + any new/changed npm packages. Run on the VPS
# after `git pull` — this is also what the GitHub Actions deploy workflow
# runs on every push to master, so it must not skip the backend install step:
# a backend-only dependency change (e.g. adding better-sqlite3) would
# otherwise pull fine but crash the restarted service with MODULE_NOT_FOUND.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Installing backend dependencies"
cd "$REPO_DIR/backend"
npm ci --omit=dev

echo "==> Importing any legacy JSON data into SQLite (no-op if already migrated)"
APP_ENV=production node migrate-to-sqlite.js

echo "==> Building frontend"
cd "$REPO_DIR/frontend"
npm ci
npm run build

echo "==> Fixing permissions for the vtamigo service user"
chmod -R o+rX "$REPO_DIR/frontend/dist" "$REPO_DIR/frontend"
chown -R vtamigo:vtamigo "$REPO_DIR/backend"

echo "==> Refreshing systemd unit (picks up e.g. new Environment= entries)"
cp "$REPO_DIR/server/vtamigo-backend.service" /etc/systemd/system/vtamigo-backend.service
systemctl daemon-reload

echo "==> Restarting backend"
systemctl restart vtamigo-backend

echo "==> Done. Serving at whatever domain nginx/vtamigo-backend is configured for."
