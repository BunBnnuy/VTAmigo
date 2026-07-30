// Central place for talking to the backend. Reads backendUrl straight from
// localStorage (not React state) so plain-JS modules like TTSController can
// use it without prop-drilling. Empty string = same-origin (default: local
// dev via the Vite proxy, or the bundled backend in the Electron build).
export function getBackendUrl() {
  try {
    const settings = JSON.parse(localStorage.getItem("settings") || "{}");
    const explicit = (settings.backendUrl || "").trim().replace(/\/+$/, "");
    if (explicit) return explicit;
  } catch {
    // fall through to dev default below
  }

  // No explicit backendUrl: same-origin. That's correct both for the packaged
  // Electron build (window loaded from http://localhost:3001, the bundled
  // backend) and for a static build hosted by the backend itself (e.g. the
  // VPS serving both frontend and API from the same origin). The one case
  // that needs a hardcoded fallback is `vite dev`, where the frontend
  // (:5173) and backend (:3001) are genuinely different origins. Talking to
  // the backend directly (rather than through Vite's dev proxy) also keeps
  // the auth session cookie scoped consistently for both fetch() and the
  // WebSocket upgrade.
  if (import.meta.env.DEV) return "http://localhost:3001";
  return "";
}

export function apiUrl(path) {
  return getBackendUrl() + path;
}

// credentials: "include" so the session cookie rides along even when the
// backend is a different origin (vite dev, or an explicit backendUrl).
export function apiFetch(path, options) {
  return fetch(apiUrl(path), { credentials: "include", ...options });
}

export function wsUrl(path) {
  const base = getBackendUrl();
  return base.replace(/^http/, "ws") + path;
}
