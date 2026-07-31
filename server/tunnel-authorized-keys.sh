#!/bin/bash
# sshd AuthorizedKeysCommand for the `tunnel` user — looks up approved device
# keys directly from devices.json instead of a static authorized_keys file,
# sidestepping StrictModes entirely (backend/devices.js only ever needs to
# write devices.json, which it already owns with normal permissions).
#
# Installed at /opt/vtamigo/server/tunnel-authorized-keys.sh, must be owned
# by root and not writable by group/other (sshd requires this of any
# AuthorizedKeysCommand). Configured via sshd_config's `Match User tunnel`
# block — see server/README.md.
set -euo pipefail

DEVICES_JSON="/opt/vtamigo/backend/devices.json"
[ -f "$DEVICES_JSON" ] || exit 0

node -e '
const devices = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
for (const d of devices) {
  if (d.status !== "approved") continue;
  const opts = [
    "restrict",
    "port-forwarding",
    "permitopen=\"127.0.0.1:8001\"",
    `permitlisten="${d.assignedPort}"`,
  ].join(",");
  console.log(`${opts} ${d.publicKey}`);
}
' "$DEVICES_JSON"
