// A CLI that exits non-zero is not the same thing as a CLI that isn't
// installed. Every provider says "not found" about sessions, models and
// files — grok answers a dead `--resume` id with `Session "…" not found
// locally` and `404 Not Found` — and reporting that as CLI_NOT_FOUND both
// lied to the streamer ("Grok CLI not found — make sure it is installed and
// on your PATH") and suppressed the fresh-session retry in runCLI, so the
// stale session was never reset and the bot stayed wedged.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const twitchId = "cli-not-found-test";
let tmpDir;

// Stands in for a provider CLI. Fails a --resume the way grok fails a dead
// session, succeeds when opening a fresh one with --session-id.
function writeShim(name, body) {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return file;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vtamigo-cli-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function seedSession(sessionId, started) {
  const { db } = require("../db");
  db.prepare(`DELETE FROM agent_sessions WHERE provider = 'grok' AND twitchId = ?`).run(twitchId);
  db.prepare(
    `INSERT INTO agent_sessions (provider, twitchId, sessionId, started) VALUES ('grok', ?, ?, ?)`
  ).run(twitchId, sessionId, started ? 1 : 0);
}

const AI_DIR = path.resolve(__dirname, "..", "ai");

// Seeds the session first on purpose: the AI session store snapshots the
// table into memory at import time, so seeding afterwards would leave the
// module opening a brand-new session with --session-id and never exercise the
// --resume path this file is about. Clearing only ../ai would leave the store
// cached, hence the whole ai/ subtree.
function loadWithSession(grokPath, sessionId, started) {
  seedSession(sessionId, started);
  process.env.GROK_PATH = grokPath;
  for (const id of Object.keys(require.cache)) {
    if (id.startsWith(AI_DIR)) delete require.cache[id];
  }
  return require("../ai");
}

const ask = (ai) => ai.queryAI([{ text: "hola" }], "auto", "", null, "grok", twitchId);

// The shims below are extensionless scripts with a `#!/usr/bin/env node`
// shebang: POSIX-kernel execution only. Windows CreateProcess can't run them
// (it appends .exe and finds nothing), so the cases that must actually
// execute a shim skip there; the ENOENT and missing-binary cases still run.
const posixOnly = it.skipIf(process.platform === "win32");

describe("a failing CLI is only 'not found' when it really is missing", () => {
  posixOnly("treats grok's dead-session error as a session problem and retries on a fresh one", async () => {
    const shim = writeShim(
      "grok-stale-session",
      `const args = process.argv.slice(2);
if (args.includes("--resume")) {
  process.stderr.write('Session "x" not found locally, restoring from remote...\\n');
  process.stderr.write("Error: Failed to restore session from remote: fetching session record: session get failed: 404 Not Found\\n");
  process.exit(1);
}
process.stdout.write("respuesta del co-host");`
    );
    const claude = loadWithSession(shim, "dead-session-id", true);

    // The retry is the whole point: the streamer gets an answer instead of a
    // bogus "install the CLI" message.
    await expect(ask(claude)).resolves.toContain("respuesta del co-host");
  });

  posixOnly("resets the stale session instead of resuming it forever", async () => {
    const shim = writeShim(
      "grok-stale-session-2",
      `const args = process.argv.slice(2);
if (args.includes("--resume")) { process.stderr.write("session get failed: 404 Not Found\\n"); process.exit(1); }
process.stdout.write("ok");`
    );
    const claude = loadWithSession(shim, "dead-session-id-2", true);
    await ask(claude);

    const { db } = require("../db");
    const row = db
      .prepare(`SELECT sessionId FROM agent_sessions WHERE provider = 'grok' AND twitchId = ?`)
      .get(twitchId);
    expect(row.sessionId).not.toBe("dead-session-id-2");
  });

  posixOnly("surfaces an unrelated failure as itself, not as a missing CLI", async () => {
    const shim = writeShim(
      "grok-rate-limited",
      `process.stderr.write("Error: rate limited, try again later\\n"); process.exit(1);`
    );
    const claude = loadWithSession(shim, "some-session", false);

    await expect(ask(claude)).rejects.toThrow(/rate limited/);
  });

  it("still reports a genuinely missing executable as CLI_NOT_FOUND", async () => {
    const claude = loadWithSession(path.join(tmpDir, "does-not-exist-at-all"), "some-session", false);

    // spawn(shell:false) surfaces this as ENOENT — the only way a missing
    // binary can actually present itself.
    await expect(ask(claude)).rejects.toThrow("CLI_NOT_FOUND");
  });

  posixOnly("still recognises a shell that could not resolve the command", async () => {
    const shim = writeShim(
      "grok-shell-miss",
      `process.stderr.write("'grok' is not recognized as an internal or external command\\n"); process.exit(1);`
    );
    const claude = loadWithSession(shim, "some-session", false);

    await expect(ask(claude)).rejects.toThrow("CLI_NOT_FOUND");
  });
});
