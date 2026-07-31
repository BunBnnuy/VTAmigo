// Server-side Umami event tracking. Sending events from the backend (instead
// of the browser calling cloud.umami.is directly) means ad blockers on the
// viewer's machine can't silently drop them — the request never leaves our
// own domain until it reaches our server.
const UMAMI_WEBSITE_ID = process.env.UMAMI_WEBSITE_ID || "21bc6984-b18f-4228-935f-d5b20daf9dae";
const UMAMI_ENDPOINT = process.env.UMAMI_ENDPOINT || "https://gateway.umami.is/api/send";

// Fire-and-forget — analytics must never affect the request it's attached to.
function sendEvent(name, { req, twitchLogin, data } = {}) {
  if (!name) return;
  const hostname = (req?.headers?.host || "vtamigo.top").split(":")[0];
  const url = req?.originalUrl || "/";
  const payload = {
    website: UMAMI_WEBSITE_ID,
    hostname,
    url,
    name,
    data: twitchLogin ? { twitchLogin, ...data } : data,
  };
  const headers = { "Content-Type": "application/json" };
  if (req?.headers?.["user-agent"]) headers["User-Agent"] = req.headers["user-agent"];
  if (req?.ip) headers["X-Forwarded-For"] = req.ip;

  fetch(UMAMI_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ payload, type: "event" }),
  }).catch((err) => console.warn("[analytics] send failed:", err.message));
}

module.exports = { sendEvent };
