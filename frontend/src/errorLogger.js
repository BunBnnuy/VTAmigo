import { apiFetch } from "./api.js";

// Reports a frontend app error to the backend so it shows up in the Admin
// panel's Errors section. Fire-and-forget, same pattern as analytics.js.
export function logError(source, err, extra) {
  const message = (err && (err.message || String(err))) || "Unknown error";
  const stack = err && err.stack;
  apiFetch("/api/log-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, stack, source, url: window.location.href, ...extra }),
  }).catch(() => {});
}

// Catches what try/catch can't: uncaught exceptions and unhandled promise
// rejections anywhere in the app. Call once on app start.
export function initErrorLogger() {
  window.addEventListener("error", (event) => {
    logError("window.onerror", event.error || new Error(event.message));
  });
  window.addEventListener("unhandledrejection", (event) => {
    logError("unhandledrejection", event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
  });
}
