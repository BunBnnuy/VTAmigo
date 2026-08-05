#!/usr/bin/env bash
# Restricts inbound HTTP/HTTPS (80/443) to Cloudflare's published edge IP
# ranges, so the origin can only be reached through Cloudflare's proxy —
# closing the "attacker finds the real IP and bypasses Cloudflare entirely"
# gap. SSH (22) is left untouched.
#
# DO NOT RUN THIS until AFTER vtamigo.top's nameservers have been switched to
# Cloudflare and the site has been confirmed to load through it (orange-cloud
# proxied). Running this first — while DNS still points straight at this
# server — will cut off every real visitor immediately, since none of them
# would be connecting from a Cloudflare IP yet.
#
# Re-run this periodically (or after this script warns the fetch failed) to
# pick up any change to Cloudflare's IP ranges — they change rarely, but do
# change occasionally.
set -euo pipefail

echo "Fetching current Cloudflare IP ranges..."
V4=$(curl -fs https://www.cloudflare.com/ips-v4/)
V6=$(curl -fs https://www.cloudflare.com/ips-v6/)

if [ -z "$V4" ] || [ -z "$V6" ]; then
  echo "Could not fetch Cloudflare IP ranges — aborting without changing anything." >&2
  exit 1
fi

echo "Removing existing open rules for 80/443 (if present)..."
ufw delete allow 80/tcp comment "HTTP (redirect)" 2>/dev/null || true
ufw delete allow 443/tcp comment "HTTPS" 2>/dev/null || true
ufw delete allow 80/tcp 2>/dev/null || true
ufw delete allow 443/tcp 2>/dev/null || true

echo "Allowing 80/443 from Cloudflare ranges only..."
for ip in $V4 $V6; do
  ufw allow from "$ip" to any port 80 proto tcp comment "Cloudflare HTTP"
  ufw allow from "$ip" to any port 443 proto tcp comment "Cloudflare HTTPS"
done

ufw status verbose
echo
echo "Done. Verify https://vtamigo.top/ and https://dev.vtamigo.top/ still load before closing this session."
