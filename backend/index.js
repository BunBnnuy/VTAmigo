// Process entry point. Everything about *what* the server does lives in
// app.js — this file only starts it: background timers, the listen() call,
// and the fatal-error handler. Keeping the two apart is what lets the test
// suite import the app and drive it with supertest without binding a port.
const vtubeManager = require("./vtubeManager");
const { server, startBackgroundJobs, PORT } = require("./app");

startBackgroundJobs();

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`[server] Port ${PORT} already in use — reusing existing backend`);
  } else {
    console.error("[server] Fatal error:", err.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  vtubeManager.bootstrap();
});
