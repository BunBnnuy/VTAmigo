import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
    // Route suites import app.js, which opens the SQLite file chosen by
    // APP_ENV (see db.js). Pinning it to "test" keeps the suite off the
    // development database — backend/data/db/vtamigo.test.sqlite3 is
    // disposable and gitignored.
    env: { APP_ENV: "test" },
    // better-sqlite3 handles are process-wide, so parallel workers would
    // fight over the same test database file.
    fileParallelism: false,
  },
});
