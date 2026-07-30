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
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

chown -R "$SERVICE_USER":"$SERVICE_USER" "$REPO_DIR/backend"

if [ ! -f "$ENV_FILE" ]; then
  echo "==> No $ENV_FILE found, copying example (edit it before starting the service)"
  cp "$REPO_DIR/server/vtamigo.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
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
