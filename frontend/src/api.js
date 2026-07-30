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
  if (!base) return `ws://localhost:3001${path}`;
  return base.replace(/^http/, "ws") + path;
}
