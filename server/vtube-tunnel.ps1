# Reverse SSH tunnel: makes the VPS's localhost:8001 forward to VTube Studio
# running on this PC. Run this before/while streaming whenever the app's
# Backend URL points at the VPS — VTS lip-sync won't work without it, since
# VTube Studio only listens locally and the backend now runs remotely.
#
# Usage: powershell -File server/vtube-tunnel.ps1
# Leave the window open for the duration of the stream; Ctrl+C to stop.

$VpsHost = "107.173.7.195"
$VpsUser = "root"
$KeyPath = "$env:USERPROFILE\.ssh\id_ed25519"

Write-Host "Starting reverse tunnel: VPS localhost:8001 -> this PC's VTube Studio (localhost:8001)"
Write-Host "Leave this window open while streaming. Ctrl+C to stop."

while ($true) {
    ssh -i $KeyPath `
        -N -R 8001:localhost:8001 `
        -o ServerAliveInterval=30 `
        -o ServerAliveCountMax=3 `
        -o ExitOnForwardFailure=yes `
        "$VpsUser@$VpsHost"

    Write-Host "Tunnel dropped, reconnecting in 5s... (Ctrl+C to stop)"
    Start-Sleep -Seconds 5
}
