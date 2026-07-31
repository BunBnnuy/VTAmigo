import { apiFetch } from "./api.js";

// Relays events through our own backend (POST /api/collect), which forwards
// them to Umami server-side. Going through our own origin means an ad
// blocker on the viewer's machine — which would silently drop a direct call
// to cloud.umami.is — has nothing third-party to block.
export function track(event, data) {
  apiFetch("/api/collect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event, data }),
  }).catch(() => {});
}
