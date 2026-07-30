// Central place for talking to the backend. Reads backendUrl straight from
// localStorage (not React state) so plain-JS modules like TTSController can
// use it without prop-drilling. Empty string = same-origin (default: local
// dev via the Vite proxy, or the bundled backend in the Electron build).
export function getBackendUrl() {
  try {
    const settings = JSON.parse(localStorage.getItem("settings") || "{}");
    return (settings.backendUrl || "").trim().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function apiUrl(path) {
  return getBackendUrl() + path;
}

export function apiFetch(path, options) {
  return fetch(apiUrl(path), options);
}

export function wsUrl(path) {
  const base = getBackendUrl();
  if (base) return base.replace(/^http/, "ws") + path;

  // No explicit backendUrl: same-origin. That's correct both for the packaged
  // Electron build (window loaded from http://localhost:3001, the bundled
  // backend) and for a static build hosted by the backend itself (e.g. the
  // VPS serving both frontend and API from the same origin). The one case
  // that needs a hardcoded fallback is `vite dev`, where the frontend
  // (:5173) and backend (:3001) are genuinely different origins and fetch()
  // only reaches the backend via Vite's dev proxy — which doesn't cover the
  // WebSocket upgrade the same way.
  if (import.meta.env.DEV) return `ws://localhost:3001${path}`;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${path}`;
}
