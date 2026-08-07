#!/bin/bash
# sshd AuthorizedKeysCommand for the `tunnel` user — looks up approved device
# keys from the backend's SQLite DB (backend/data/db/vtamigo.<env>.sqlite3)
# instead of a static authorized_keys file, sidestepping StrictModes entirely
# (backend/devices.js only ever needs to write to that DB, which it already
# owns with normal permissions). Previously read devices.json directly.
#
# Installed at /opt/vtamigo/server/tunnel-authorized-keys.sh, must be owned
# by root and not writable by group/other (sshd requires this of any
# AuthorizedKeysCommand). Configured via sshd_config's `Match User tunnel`
# block — see server/README.md.
set -euo pipefail

APP_ENV="${APP_ENV:-production}"
DB_FILE="/opt/vtamigo/backend/data/db/vtamigo.${APP_ENV}.sqlite3"
[ -f "$DB_FILE" ] || exit 0

node -e '
const Database = require("/opt/vtamigo/backend/node_modules/better-sqlite3");
const db = new Database(process.argv[1], { readonly: true });
const devices = db.prepare("SELECT publicKey, assignedPort FROM devices WHERE status = ?").all("approved");
for (const d of devices) {
  const opts = [
    "restrict",
    "port-forwarding",
    "permitopen=\"127.0.0.1:8001\"",
    `permitlisten="${d.assignedPort}"`,
  ].join(",");
  console.log(`${opts} ${d.publicKey}`);
}
' "$DB_FILE"
