#!/usr/bin/env bash
# Installs the VTAmigo backend as a systemd service.
# Run after server/setup.sh: sudo bash server/install-service.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo bash server/install-service.sh)" >&2
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="vtamigo-backend"
SERVICE_USER="vtamigo"
ENV_FILE="/etc/vtamigo.env"

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "==> Creating service user '$SERVICE_USER'"
  # Needs a home dir: the service runs as this user (not root) and systemd
  # sets HOME to it (see vtamigo-backend.service).
  useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# --- Agent CLI credentials: NEVER copy /root/.claude, .claude.json,
# .config/grok, .agy (or any other account's CLI login) into the service
# user's home. Rationale (Security Issue 1):
#   * The backend spawns the provider CLIs with tool access disabled and an
#     emptied HOME, so file-based OAuth logins are UNUSED — Claude runs with
#     --bare, which ignores OAuth/keychain files entirely and authenticates
#     strictly via ANTHROPIC_API_KEY.
#   * Copying another account's credentials across users turns one compromised
#     box into two compromised accounts and breaks credential ownership.
# Authenticate with API-key env vars in the root-owned 0600 env file instead:
#   ANTHROPIC_API_KEY=...   (Claude — required, --bare reads nothing else)
#   XAI_API_KEY=...         (Grok — if your build supports env auth)
#   AGY_API_KEY=...         (AGY — if your build supports env auth)
# If a provider only supports interactive login, run its `login` command AS
# the service user (sudo -u "$SERVICE_USER" -H <cli> login) — never copy
# another user's files. See server/vtamigo.env.example.
chown -R "$SERVICE_USER":"$SERVICE_USER" "/home/$SERVICE_USER"

# Code stays root-owned so a compromised service account cannot rewrite the
# backend it runs from. The service user gets ownership of the runtime DATA
# dirs only (SQLite lives in data/db, uploads/avatars/overlay assets in
# data/*, memory exports in memories/).
mkdir -p "$REPO_DIR/backend/data" "$REPO_DIR/backend/memories"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$REPO_DIR/backend/data" "$REPO_DIR/backend/memories"

if [ ! -f "$ENV_FILE" ]; then
  echo "==> No $ENV_FILE found, copying example (edit it before starting the service)"
  cp "$REPO_DIR/server/vtamigo.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# The agent CLIs authenticate via API keys in the env file (see above) — warn
# early if none is configured instead of failing obscurely at first /respond.
if ! grep -qE '^[A-Z_]*API_KEY=.+' "$ENV_FILE" 2>/dev/null; then
  echo "==> WARNING: no *_API_KEY set in $ENV_FILE — the Claude provider needs"
  echo "    ANTHROPIC_API_KEY there (Claude runs with --bare: file-based CLI"
  echo "    logins are ignored). Add keys, then start the service."
fi

echo "==> Writing systemd unit"
NODE_BIN="$(command -v node)"
sed \
  -e "s#WorkingDirectory=.*#WorkingDirectory=$REPO_DIR/backend#" \
  -e "s#ExecStart=.*#ExecStart=$NODE_BIN index.js#" \
  "$REPO_DIR/server/vtamigo-backend.service" > "/etc/systemd/system/$SERVICE_NAME.service"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo ""
echo "==> Installed. Edit $ENV_FILE, then start with:"
echo "  sudo systemctl start $SERVICE_NAME"
echo "  sudo journalctl -u $SERVICE_NAME -f"
