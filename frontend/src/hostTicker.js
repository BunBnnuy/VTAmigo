// Background-tab-safe ticker for the autonomous host.
//
// Chromium throttles a hidden tab's setInterval to about once a minute. During
// a 12-hour stream the operator will not keep the dashboard focused, and a
// 45-second playout cadence collapsing to one minute would be audible dead
// air. A timer inside a worker is not throttled the same way, so the playout
// and the rolling deck generation keep their rhythm while the tab is hidden.
//
// Falls back to setInterval where Worker/Blob are unavailable (jsdom, older
// embedded browsers), which is correct for tests and harmless elsewhere.
const WORKER_SOURCE = `
let timer = null;
self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type === "start") {
    if (timer) clearInterval(timer);
    timer = setInterval(() => self.postMessage("tick"), data.intervalMs || 5000);
  } else if (data.type === "stop") {
    if (timer) clearInterval(timer);
    timer = null;
  }
};
`;

export function startHostTicker(onTick, intervalMs = 5000) {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
    const id = setInterval(onTick, intervalMs);
    return () => clearInterval(id);
  }

  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "application/javascript" }));
  let worker;
  try {
    worker = new Worker(url);
  } catch {
    URL.revokeObjectURL(url);
    const id = setInterval(onTick, intervalMs);
    return () => clearInterval(id);
  }

  worker.onmessage = () => onTick();
  worker.postMessage({ type: "start", intervalMs });

  return () => {
    try {
      worker.postMessage({ type: "stop" });
      worker.terminate();
    } finally {
      URL.revokeObjectURL(url);
    }
  };
}
