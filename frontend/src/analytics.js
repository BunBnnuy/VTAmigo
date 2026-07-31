// Thin wrapper around the Umami global — safe to call even before the
// cloud script has loaded (e.g. blocked by an adblocker) or on unsupported
// environments (SSR, tests).

export function track(event, data) {
  try {
    if (window.umami && typeof window.umami.track === "function") {
      window.umami.track(event, data);
    }
  } catch {}
}

export function identify(uniqueId, data) {
  try {
    if (window.umami && typeof window.umami.identify === "function") {
      window.umami.identify(uniqueId, data);
    }
  } catch {}
}
