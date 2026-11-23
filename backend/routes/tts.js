// Text-to-speech: the local Piper CLI, KittenTTS and Kokoro voices, plus the
// two routes that tell an account's avatar overlay whether TTS audio is
// currently playing.
//
// Both halves belong to the same "the bot is talking" moment — the frontend
// player calls /avatar/speaking/start right before it plays a local TTS clip
// and /avatar/speaking/stop when it ends — which is why they share a router
// even though the avatar *images* are served by routes/overlays.js.
//
// "/avatar" and "/tts" are both PROTECTED_PREFIXES entries, so req.user is
// already populated by the blanket gate in app.js, which is registered before
// this router is mounted. backend/test/purge.test.js depends on that gate
// answering 401 for the removed /tts/elevenlabs* routes.
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");
const piper = require("../piper");
const visemes = require("../visemes");
const fish = require("../fish");
const vrmConfig = require("../vrmConfig");
const kitten = require("../kitten");
const kokoro = require("../kokoro");
const { aiLimiter } = require("../rateLimits");
const { requireOwner, isOwner, getApprovedUserFromCookieHeader, findUserByOverlayToken } = require("../auth");
const { broadcastToAccount } = require("../sessions");

const router = express.Router();

// Resolves who an OBS-facing route is acting for — `?token=` overlay token OR
// the streamer's session cookie, same dual auth as /xp/ranking and
// /overlay/custom/*. The OBS Browser Source is a separate CEF instance with no
// access to the session cookie, so token is the normal path.
function overlayUser(req) {
  return (req.query.token && findUserByOverlayToken(req.query.token)) || getApprovedUserFromCookieHeader(req.headers.cookie);
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// One mapping for every Piper failure so /tts/piper and /overlay/tts/piper
// answer identically.
function sendPiperError(res, err) {
  if (err.message === "PIPER_BUSY") return res.status(429).json({ error: "TTS is busy, try again shortly" });
  if (err.message === "PIPER_TEXT_TOO_LONG") return res.status(400).json({ error: `Text too long (max ${piper.MAX_TEXT_CHARS} characters)` });
  if (err.message === "PIPER_NOT_INSTALLED") return res.status(503).json({ error: "piper.exe not found in projects/piperttsspanish" });
  if (err.message === "PIPER_BAD_VOICE") return res.status(400).json({ error: "Unknown Piper voice (must be a .onnx file in voices/)" });
  console.error("[piper/tts]", err.message);
  res.status(502).json({ error: err.message });
}

// Same mapping for the Python sidecars (KittenTTS, Kokoro). Codes end in a
// stable suffix (`*_BUSY`, `*_TIMEOUT`, ...); the engine prefix differs, so
// matching the suffix keeps one handler for both.
function sendWorkerError(res, err, label, maxChars, dirName) {
  const message = err.message || "";
  const code = message.split(":")[0];
  if (code.endsWith("_BUSY")) return res.status(429).json({ error: "TTS is busy, try again shortly" });
  if (code.endsWith("_TEXT_TOO_LONG")) return res.status(400).json({ error: `Text too long (max ${maxChars} characters)` });
  if (code.endsWith("_NOT_INSTALLED")) return res.status(503).json({ error: `${label} is not installed (run server/setup.sh or check backend/${dirName})` });
  if (code.endsWith("_NOT_WRITABLE")) return res.status(503).json({ error: message });
  if (code.endsWith("_BAD_VOICE")) return res.status(400).json({ error: `Unknown ${label} voice` });
  if (code.endsWith("_TIMEOUT")) return res.status(504).json({ error: `${label} took too long, try again` });
  console.error(`[${label}/tts]`, message);
  res.status(502).json({ error: message });
}

// ── Avatar speaking state ─────────────────────────────────────────────────────
//
// These two routes are the *only* driver of the avatar-swap overlay
// (backend/overlay/avatar.html): it flips between the uploaded speaking and
// silent images purely on the { type: "tts_state", playing } messages
// broadcast here over the /chat WS. The frontend TTS player calls start
// right before it plays a clip and stop when playback ends or is cancelled.
//
// They used to be POST /lipsync/start|stop and also drove VTube Studio (mouth
// phonemes + head-bob animations) through a per-account VTS tunnel — a
// leftover from the single-streamer Windows desktop build, where the backend
// ran on the streamer's own PC next to VTube Studio. The hosted multi-account
// site can't reach anyone's local VTS, so that half is gone; the broadcast,
// which every account's overlay depends on, is not.

// POST /avatar/speaking/start — { text, durationMs } — tells this account's
// avatar overlay to show the "speaking" image.
router.post("/avatar/speaking/start", (req, res) => {
  const { text, durationMs } = req.body || {};
  if (!text || !durationMs) return res.status(400).json({ error: "text and durationMs required" });

  broadcastToAccount(req.user.twitchId, { type: "tts_state", playing: true });
  res.json({ ok: true });
});

// POST /avatar/speaking/stop — back to the "silent" image.
router.post("/avatar/speaking/stop", (req, res) => {
  broadcastToAccount(req.user.twitchId, { type: "tts_state", playing: false });
  res.json({ ok: true });
});

// Fish Audio answers 401/402/429/503 with a JSON body; map them to something
// the UI can show without leaking the API key or the raw upstream payload.
function sendFishError(res, err) {
  const code = (err.message || "").split(":")[0];
  if (code === "FISH_NOT_CONFIGURED") {
    return res.status(503).json({ error: "Fish Audio is not configured (set FISH_AUDIO_API_KEY)" });
  }
  if (code === "FISH_TEXT_TOO_LONG") {
    return res.status(400).json({ error: `Text too long (max ${fish.MAX_TEXT_CHARS} characters)` });
  }
  if (code === "FISH_TIMEOUT") return res.status(504).json({ error: "Fish Audio took too long, try again" });
  if (code === "FISH_HTTP_401" || code === "FISH_HTTP_403") {
    return res.status(502).json({ error: "Fish Audio rejected the API key" });
  }
  if (code === "FISH_HTTP_402") return res.status(402).json({ error: "Fish Audio balance exhausted" });
  if (code === "FISH_HTTP_429") return res.status(429).json({ error: "Fish Audio rate limit, slow down" });
  if (code === "FISH_HTTP_503") return res.status(503).json({ error: "Fish Audio is overloaded, try again" });
  console.error("[fish/tts]", err.message);
  res.status(502).json({ error: err.message });
}

// ── Piper TTS (local CLI) ─────────────────────────────────────────────────────

// GET /tts/piper/voices — { installed, voices: [{ id, name }] }
router.get("/tts/piper/voices", (req, res) => {
  res.json({ installed: piper.isInstalled(), voices: piper.listVoices() });
});

// POST /tts/piper — { text, voice? } → audio/wav. Shares aiLimiter (5/min
// per IP) with POST /respond: each call spawns the local Piper exe.
router.post("/tts/piper", aiLimiter, async (req, res) => {
  const { text, voice } = req.body || {};
  if (!text) return res.status(400).json({ error: "text is required" });
  try {
    const audio = await piper.generateSpeech({ text, voice });
    res.set("Content-Type", "audio/wav");
    res.send(audio);
  } catch (err) {
    sendPiperError(res, err);
  }
});

// POST /tts/visemes — { text, voice? } → JSON { audio (base64 wav), visemes }
// Prototype for the VRM lab: the same Piper audio plus a lip-sync timeline
// derived from the exact phonemes the voice model consumes. Kept in the same
// router as /tts/piper so both share the aiLimiter budget (one Piper spawn
// each) and the /tts auth gate in app.js.
router.post("/tts/visemes", requireOwner, aiLimiter, async (req, res) => {
  const { text, voice, provider, speed } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });
  try {
    res.json(await visemes.speechWithVisemes({ text, voice, provider, speed }));
  } catch (err) {
    if (provider === "fish") return sendFishError(res, err);
    sendPiperError(res, err);
  }
});

// ── KittenTTS (local Python worker) ──────────────────────────────────────────

// GET /tts/kitten/voices — { installed, voices: [{ id, name }] }
router.get("/tts/kitten/voices", (req, res) => {
  res.json({ installed: kitten.isInstalled(), voices: kitten.listVoices() });
});

// POST /tts/kitten — { text, voice?, speed? } → audio/wav. Shares aiLimiter
// with Piper and /respond: each call ties up the single Python worker.
router.post("/tts/kitten", aiLimiter, async (req, res) => {
  const { text, voice, speed } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });
  try {
    const audio = await kitten.generateSpeech({ text, voice, speed });
    res.set("Content-Type", "audio/wav");
    res.send(audio);
  } catch (err) {
    sendWorkerError(res, err, "KittenTTS", kitten.maxTextChars, "kitten/.venv");
  }
});

// ── Kokoro-82M (local Python worker) ─────────────────────────────────────────

// GET /tts/kokoro/voices — { installed, voices: [{ id, name }] }
router.get("/tts/kokoro/voices", (req, res) => {
  res.json({ installed: kokoro.isInstalled(), voices: kokoro.listVoices() });
});

// POST /tts/kokoro — { text, voice?, speed? } → audio/wav. The provider to
// pick for Spanish: Kokoro ships ef_dora/em_alex/em_santa.
router.post("/tts/kokoro", aiLimiter, async (req, res) => {
  const { text, voice, speed } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });
  try {
    const audio = await kokoro.generateSpeech({ text, voice, speed });
    res.set("Content-Type", "audio/wav");
    res.send(audio);
  } catch (err) {
    sendWorkerError(res, err, "Kokoro", kokoro.maxTextChars, "kokoro");
  }
});

// ── Fish Audio (hosted API) ──────────────────────────────────────────────────
//
// Free developer tier: the provider sends `model: s2.1-pro-free`, which Fish
// lists at $0 per UTF-8 byte. Voices are reference ids, so `voice` is an opaque
// model id rather than a local file. Without FISH_AUDIO_API_KEY the status
// route says so and the rest of the app keeps using the local engines.

router.get("/tts/fish/status", (req, res) => {
  res.json(fish.status());
});

// GET /tts/fish/voices — account-owned voice models (clones). Cached for five
// minutes in fish.js because Settings asks on mount and on every refresh.
router.get("/tts/fish/voices", async (req, res) => {
  if (!fish.isConfigured()) return res.json({ configured: false, voices: [] });
  try {
    res.json({ configured: true, voices: await fish.listVoices({ force: req.query.refresh === "1" }) });
  } catch (err) {
    res.json({ configured: true, voices: [], error: err.message });
  }
});

// POST /tts/fish — { text, voice?, speed? } → audio/wav. Shares aiLimiter with
// the other engines: each call is a paid (or free-tier) upstream request.
router.post("/tts/fish", aiLimiter, async (req, res) => {
  const { text, voice, speed } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });
  try {
    const audio = await fish.generateSpeech({ text, voice, speed });
    res.set("Content-Type", "audio/wav");
    res.send(audio);
  } catch (err) {
    sendFishError(res, err);
  }
});

// ── VRM overlay config ───────────────────────────────────────────────────────
//
// The lab (session auth) saves the model + idle choices; the OBS page (overlay
// token) reads them so it reloads the same VRM without any manual step.

// Uploaded VRM models. Runtime data (gitignored) on purpose: a 250 MB+ avatar
// must never live in git or in frontend/dist. The URL stored in vrm_config is
// a same-origin path served by the route below, not a data URL.
const VRM_DIR = path.join(__dirname, "..", "data", "vrm");
fs.mkdirSync(VRM_DIR, { recursive: true });

// Chunked uploads. Cloudflare sits in front of the site and rejects a single
// request body over its plan limit (100 MB on Free/Pro), so the browser sends
// the model in 16 MB pieces and the server assembles them. This is also what
// makes per-chunk retries and an honest progress bar possible.
const VRM_CHUNK_DIR = path.join(VRM_DIR, ".uploads");
fs.mkdirSync(VRM_CHUNK_DIR, { recursive: true });
const VRM_UPLOAD_ID_RE = /^[a-f0-9-]{36}$/;
const VRM_CHUNK_BYTES = 8 * 1024 * 1024;
const VRM_MAX_CHUNKS = 20000; // ~320 GB sanity cap; not a practical limit

// A crashed/aborted upload leaves a .part or a chunk dir behind; clean
// anything stale periodically. Twelve hours is far longer than any real
// upload, so this can never race an in-flight one.
function cleanupStaleVrmUploads() {
  try {
    for (const name of fs.readdirSync(VRM_DIR)) {
      if (!name.endsWith(".part")) continue;
      const full = path.join(VRM_DIR, name);
      if (Date.now() - fs.statSync(full).mtimeMs > 12 * 60 * 60 * 1000) fs.unlinkSync(full);
    }
  } catch {
    /* best-effort housekeeping */
  }
  try {
    for (const name of fs.readdirSync(VRM_CHUNK_DIR)) {
      const full = path.join(VRM_CHUNK_DIR, name);
      try {
        if (Date.now() - fs.statSync(full).mtimeMs > 12 * 60 * 60 * 1000) {
          fs.rmSync(full, { recursive: true, force: true });
        }
      } catch {
        /* one bad entry must not stop the sweep */
      }
    }
  } catch {
    /* best-effort housekeeping */
  }
}
cleanupStaleVrmUploads();
// An abandoned 300 MB chunk set should not sit on disk for weeks.
const vrmCleanupTimer = setInterval(cleanupStaleVrmUploads, 60 * 60 * 1000);
vrmCleanupTimer.unref?.();

const vrmStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VRM_DIR),
  filename: (req, file, cb) => {
    const name = `${crypto.randomUUID()}.vrm.part`;
    // Remember the partial path so an aborted request can delete it even
    // before multer populates req.file.
    req._vrmUploadPath = path.join(VRM_DIR, name);
    cb(null, name);
  },
});

// No `limits.fileSize`: the owner's VRMs can exceed 250 MB. The only cap is
// the disk-space guard below, which is about protecting the server, not about
// rejecting a legitimately large avatar.
const vrmUpload = multer({ storage: vrmStorage });

const chunkStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, req._chunkDir),
  filename: (req, file, cb) => cb(null, `${req.params.index}.part`),
});
const chunkUpload = multer({ storage: chunkStorage });

const VRM_FILE_RE = /^[a-f0-9-]{36}\.vrm$/;

function freeVrmDiskBytes() {
  try {
    const st = fs.statfsSync(VRM_DIR);
    return Number(st.bavail) * Number(st.bsize);
  } catch {
    return null; // unknown: let the upload try rather than block it
  }
}

router.get("/vrm-lab/config", requireOwner, (req, res) => {
  res.json(vrmConfig.get(req.user.twitchId));
});

router.post("/vrm-lab/config", requireOwner, (req, res) => {
  try {
    res.json(vrmConfig.save(req.user.twitchId, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /vrm-lab/model — multipart upload of a .vrm (GLB) file. Streams
// straight to backend/data/vrm and answers the same-origin URL the config
// should store. Owner-only: this is the streamer's own avatar, not a shared
// asset library.
router.post("/vrm-lab/model", requireOwner, (req, res) => {
  // Keep at least 1 GB of headroom after this body. Uses Content-Length when
  // present (normal browser upload) and a 2 GB floor for chunked bodies.
  const free = freeVrmDiskBytes();
  if (free != null) {
    const declared = Number(req.headers["content-length"]);
    const needed = (Number.isFinite(declared) && declared > 0 ? declared : 2 * 1024 ** 3) + 1024 ** 3;
    if (free < needed) {
      return res.status(507).json({ error: "No hay espacio suficiente en el servidor para este modelo" });
    }
  }

  let finished = false;
  const cleanup = () => {
    if (finished) return;
    finished = true;
    const part = req._vrmUploadPath;
    if (part) fs.unlink(part, () => {});
  };
  req.on("aborted", cleanup);
  res.on("close", cleanup);

  vrmUpload.single("file")(req, res, (err) => {
    if (err) {
      cleanup();
      console.error("[vrm-upload]", err.message);
      return res.status(400).json({ error: err.message || "Upload failed" });
    }
    if (!req.file) return res.status(400).json({ error: "file is required" });
    finished = true;

    const partPath = req.file.path;
    try {
      // VRM is a binary glTF: the first four bytes must be the GLB magic.
      // This rejects an arbitrary file renamed to .vrm before it is served.
      const fd = fs.openSync(partPath, "r");
      const header = Buffer.alloc(12);
      fs.readSync(fd, header, 0, 12, 0);
      fs.closeSync(fd);
      if (header.toString("ascii", 0, 4) !== "glTF") {
        fs.unlinkSync(partPath);
        return res.status(400).json({ error: "El archivo no es un VRM/GLB válido" });
      }
      const name = path.basename(partPath).replace(/\.part$/, "");
      fs.renameSync(partPath, path.join(VRM_DIR, name));
      res.json({
        url: `/vrm-lab/models/${name}`,
        name: req.file.originalname || name,
        bytes: req.file.size,
      });
    } catch (uploadErr) {
      try {
        fs.unlinkSync(partPath);
      } catch {
        /* already gone */
      }
      console.error("[vrm-upload]", uploadErr.message);
      res.status(500).json({ error: "No se pudo guardar el modelo" });
    }
  });
});

// POST /vrm-lab/model/init — start a chunked upload. The client declares the
// total size first so the server can refuse a body that would fill the disk.
router.post("/vrm-lab/model/init", requireOwner, (req, res) => {
  const body = req.body || {};
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) {
    return res.status(400).json({ error: "size is required" });
  }
  const chunks = Math.ceil(size / VRM_CHUNK_BYTES);
  if (chunks > VRM_MAX_CHUNKS) {
    return res.status(400).json({ error: "El archivo es demasiado grande" });
  }
  const free = freeVrmDiskBytes();
  if (free != null && free < size + 1024 ** 3) {
    return res.status(507).json({ error: "No hay espacio suficiente en el servidor para este modelo" });
  }
  const uploadId = crypto.randomUUID();
  const dir = path.join(VRM_CHUNK_DIR, uploadId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({
      size,
      chunks,
      name: String(body.name || "").slice(0, 200),
      owner: req.user.twitchId,
      createdAt: Date.now(),
    })
  );
  res.json({ uploadId, chunkSize: VRM_CHUNK_BYTES, chunks });
});

// POST /vrm-lab/model/chunk/:uploadId/:index — one 8 MB piece. The file field
// is the only multipart part; the identifiers ride in the URL so multer can
// pick its destination directory before parsing any fields.
router.post("/vrm-lab/model/chunk/:uploadId/:index", requireOwner, (req, res) => {
  const uploadId = String(req.params.uploadId || "");
  const index = Number(req.params.index);
  if (!VRM_UPLOAD_ID_RE.test(uploadId)) {
    return res.status(400).json({ error: "Invalid upload" });
  }
  const dir = path.join(VRM_CHUNK_DIR, uploadId);
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  } catch {
    return res.status(404).json({ error: "Upload not found" });
  }
  if (!Number.isInteger(index) || index < 0 || index >= meta.chunks) {
    return res.status(400).json({ error: "Invalid chunk" });
  }
  if (meta.owner && meta.owner !== req.user.twitchId) {
    return res.status(404).json({ error: "Upload not found" });
  }
  req._chunkDir = dir;
  chunkUpload.single("file")(req, res, (err) => {
    if (err) {
      console.error("[vrm-upload] chunk:", err.message);
      return res.status(400).json({ error: err.message || "Chunk upload failed" });
    }
    if (!req.file) return res.status(400).json({ error: "file is required" });
    res.json({ ok: true, index, bytes: req.file.size });
  });
});

// POST /vrm-lab/model/complete — assemble the chunks, validate the GLB magic
// and publish the model. Chunks are deleted as they are copied, so peak disk
// use stays close to one copy of the file.
router.post("/vrm-lab/model/complete", requireOwner, async (req, res) => {
  const uploadId = String((req.body || {}).uploadId || "");
  if (!VRM_UPLOAD_ID_RE.test(uploadId)) {
    return res.status(400).json({ error: "Invalid upload" });
  }
  const dir = path.join(VRM_CHUNK_DIR, uploadId);
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  } catch {
    return res.status(404).json({ error: "Upload not found" });
  }

  if (meta.owner && meta.owner !== req.user.twitchId) {
    return res.status(404).json({ error: "Upload not found" });
  }

  const finalId = crypto.randomUUID();
  const partPath = path.join(VRM_DIR, `${finalId}.vrm.part`);
  let out = null;
  try {
    out = fs.createWriteStream(partPath);
    const finished = new Promise((resolve, reject) => {
      out.on("finish", resolve);
      out.on("error", reject);
    });
    let total = 0;
    for (let i = 0; i < meta.chunks; i++) {
      const chunkPath = path.join(dir, `${i}.part`);
      total += fs.statSync(chunkPath).size;
      await new Promise((resolve, reject) => {
        const rs = fs.createReadStream(chunkPath);
        rs.on("error", reject);
        rs.on("end", resolve);
        rs.pipe(out, { end: false });
      });
      fs.unlinkSync(chunkPath);
    }
    out.end();
    await finished;

    if (total !== meta.size) throw new Error("SIZE_MISMATCH");

    const fd = fs.openSync(partPath, "r");
    const header = Buffer.alloc(12);
    fs.readSync(fd, header, 0, 12, 0);
    fs.closeSync(fd);
    if (header.toString("ascii", 0, 4) !== "glTF") throw new Error("NOT_VRM");

    fs.renameSync(partPath, path.join(VRM_DIR, `${finalId}.vrm`));
    fs.rmSync(dir, { recursive: true, force: true });
    res.json({
      url: `/vrm-lab/models/${finalId}.vrm`,
      name: meta.name || `${finalId}.vrm`,
      bytes: total,
    });
  } catch (err) {
    try {
      out?.destroy();
    } catch {
      /* already closed */
    }
    try {
      fs.rmSync(partPath, { force: true });
    } catch {
      /* already gone */
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }
    if (err.code === "ENOENT") return res.status(400).json({ error: "Faltan trozos de la subida" });
    if (err.message === "SIZE_MISMATCH") return res.status(400).json({ error: "El tamaño final no coincide" });
    if (err.message === "NOT_VRM") return res.status(400).json({ error: "El archivo no es un VRM/GLB válido" });
    console.error("[vrm-upload] complete:", err.message);
    return res.status(500).json({ error: "No se pudo montar el modelo" });
  }
});

// POST /vrm-lab/model/abort — drop a half-uploaded model and its chunks.
router.post("/vrm-lab/model/abort", requireOwner, (req, res) => {
  const uploadId = String((req.body || {}).uploadId || "");
  if (!VRM_UPLOAD_ID_RE.test(uploadId)) {
    return res.status(400).json({ error: "Invalid upload" });
  }
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(VRM_CHUNK_DIR, uploadId, "meta.json"), "utf8"));
  } catch {
    /* already gone: abort is idempotent */
  }
  if (meta?.owner && meta.owner !== req.user.twitchId) {
    return res.status(404).json({ error: "Upload not found" });
  }
  try {
    fs.rmSync(path.join(VRM_CHUNK_DIR, uploadId), { recursive: true, force: true });
  } catch {
    /* already gone */
  }
  res.json({ ok: true });
});

// GET /vrm-lab/models/:file — the stored model itself. Session cookie (lab)
// or overlay token (OBS page), owner only. sendFile streams it and handles
// Range requests, so a 300 MB VRM does not sit in memory.
router.get("/vrm-lab/models/:file", (req, res) => {
  const user = overlayUser(req);
  if (!user || !isOwner(user)) return res.status(404).json({ error: "Not found" });
  const name = String(req.params.file || "");
  if (!VRM_FILE_RE.test(name)) return res.status(400).json({ error: "Invalid file" });
  const full = path.join(VRM_DIR, name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: "Not found" });
  res.sendFile(full, {
    headers: {
      "Content-Type": "model/gltf-binary",
      // The filename is a UUID, so a new upload is a new URL: caching is safe.
      "Cache-Control": "private, max-age=86400",
    },
  });
});

// The autonomous-host acts the VRM overlay knows how to perform. Kept here
// (not free-form) so a compromised/buggy client can't send arbitrary labels
// into the stage.
const VRM_ACTS = new Set([
  "neutral", "greeting", "thanks", "question", "thinking",
  "listening", "happy", "surprised", "sad", "angry",
]);

// POST /vrm-lab/act — { act } → broadcast a one-shot gesture/expression to
// this account's VRM overlay. This is the <1s visual acknowledgement: the
// avatar reacts the moment a chat message arrives, long before the slow AI
// reply has any audio. Owner-only, like the rest of the VRM surface.
router.post("/vrm-lab/act", requireOwner, (req, res) => {
  const act = String((req.body || {}).act || "");
  if (!VRM_ACTS.has(act)) return res.status(400).json({ error: "Invalid act" });
  broadcastToAccount(req.user.twitchId, { type: "bot_act", act });
  res.json({ ok: true, act });
});

router.get("/overlay/vrm/config", (req, res) => {
  const user = overlayUser(req);
  if (!user || !isOwner(user)) return res.status(404).json({ error: "Not found" });
  const config = vrmConfig.get(user.twitchId);
  // Uploaded models live behind the owner-only route above. OBS cannot send
  // the session cookie, so hand it the URL with its overlay token attached
  // (works for both the same-origin path and an absolute backendUrl).
  if (config.modelUrl && config.modelUrl.includes("/vrm-lab/models/") && req.query.token) {
    const joiner = config.modelUrl.includes("?") ? "&" : "?";
    config.modelUrl += `${joiner}token=${encodeURIComponent(req.query.token)}`;
  }
  res.json(config);
});

// POST /overlay/tts/visemes?token=... — { text, voice?, provider?, speed? } →
// JSON with base64 WAV + viseme timeline. Same contract as /tts/visemes but
// authenticated by the OBS overlay token and outside aiLimiter: the overlay is
// the audible source and speaks far more than 5 lines/min.
router.post("/overlay/tts/visemes", async (req, res) => {
  const user = overlayUser(req);
  if (!user || !isOwner(user)) return res.status(404).json({ error: "Not found" });
  const { text, voice, provider, speed } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });
  try {
    res.json(await visemes.speechWithVisemes({ text, voice, provider, speed }));
  } catch (err) {
    if (provider === "fish") return sendFishError(res, err);
    if (provider === "kitten") return sendWorkerError(res, err, "KittenTTS", kitten.maxTextChars, "kitten");
    if (provider === "kokoro") return sendWorkerError(res, err, "Kokoro", kokoro.maxTextChars, "kokoro");
    sendPiperError(res, err);
  }
});

// ── Voice overlay (OBS browser source) ───────────────────────────────────────
//
// The separate "bot voice" overlay plays the AI's TTS inside OBS, so the
// streamer no longer has to capture the app window's audio. The app POSTs the
// response text to /tts/speak (session-authed, under the "/tts" prefix); that
// broadcasts a {type:"tts_speak"} event to the account, and overlay/voice.html
// queues it, speaks it (Kokoro/KittenTTS when selected, browser voices first,
// Piper as the fallback that actually exists inside OBS's CEF), and reports
// the audible window back so the avatar overlay keeps mouth-syncing.

// POST /tts/speak — { text, voiceURI, piperVoice, kittenVoice, kokoroVoice, fishVoice, ttsProvider, rate, volume, forcePiper }
router.post("/tts/speak", (req, res) => {
  const { text, voiceURI, piperVoice, kittenVoice, kokoroVoice, fishVoice, ttsProvider, rate, volume, forcePiper } = req.body || {};
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean) return res.status(400).json({ error: "text is required" });

  broadcastToAccount(req.user.twitchId, {
    type: "tts_speak",
    text: clean.slice(0, piper.MAX_TEXT_CHARS),
    voiceURI: voiceURI || null,
    piperVoice: piperVoice || null,
    kittenVoice: kittenVoice || null,
    kokoroVoice: kokoroVoice || null,
    fishVoice: fishVoice || null,
    // Which engine the app picked. The overlay uses this to choose the
    // neural/hosted engine over its browser-voice/Piper fallback chain.
    ttsProvider: ["kitten", "kokoro", "fish"].includes(ttsProvider) ? ttsProvider : null,
    rate: clampNum(rate, 0.5, 2, 1),
    volume: clampNum(volume, 0, 1, 1),
    forcePiper: !!forcePiper,
  });
  res.json({ ok: true });
});

// POST /tts/skip — the app's Skip button, when the voice overlay is the active
// output: tell the overlay to drop its queue and stop the current clip.
router.post("/tts/skip", (req, res) => {
  broadcastToAccount(req.user.twitchId, { type: "tts_skip" });
  res.json({ ok: true });
});

// POST /tts/chat-speak — the separate chat-command TTS queue ("!tts ..."). Same
// payload as /tts/speak but broadcast as its own message type, so the Chat TTS
// overlay source and the bot-voice overlay never play each other's lines.
router.post("/tts/chat-speak", (req, res) => {
  const { text, voiceURI, piperVoice, rate, volume, forcePiper } = req.body || {};
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean) return res.status(400).json({ error: "text is required" });

  broadcastToAccount(req.user.twitchId, {
    type: "chat_tts_speak",
    text: clean.slice(0, piper.MAX_TEXT_CHARS),
    voiceURI: voiceURI || null,
    piperVoice: piperVoice || null,
    rate: clampNum(rate, 0.5, 2, 1),
    volume: clampNum(volume, 0, 1, 1),
    forcePiper: !!forcePiper,
  });
  res.json({ ok: true });
});

// POST /tts/chat-skip — chat TTS has no skip button, but disabling it (or a
// mute) should silence a clip already queued on the overlay.
router.post("/tts/chat-skip", (req, res) => {
  broadcastToAccount(req.user.twitchId, { type: "chat_tts_skip" });
  res.json({ ok: true });
});

// GET /overlay/voice — the transparent OBS page itself.
router.get("/overlay/voice", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "voice.html"));
});

// GET /overlay/chat-tts — the chat-command TTS overlay page.
router.get("/overlay/chat-tts", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "overlay", "chat-tts.html"));
});

// POST /overlay/tts/piper?token=... — { text, voice } → audio/wav. The voice
// overlay's fallback engine when the OBS browser engine has no
// speechSynthesis voices. Not behind aiLimiter: OBS shares one IP and a
// streamer can legitimately speak far more than 5 clips/min — Piper's own
// concurrency cap (PIPER_BUSY) is the real backpressure here.
router.post("/overlay/tts/piper", async (req, res) => {
  const user = overlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const { text, voice } = req.body || {};
  if (!text) return res.status(400).json({ error: "text is required" });
  try {
    const audio = await piper.generateSpeech({ text, voice });
    res.set("Content-Type", "audio/wav");
    res.send(audio);
  } catch (err) {
    sendPiperError(res, err);
  }
});

// POST /overlay/tts/kitten?token=... — { text, voice, speed? } → audio/wav.
// Same contract as /tts/kitten but authenticated by the OBS overlay token, and
// deliberately not behind aiLimiter (OBS shares one IP and speaks far more
// than 5 clips/min); the worker's own concurrency cap is the backpressure.
router.post("/overlay/tts/kitten", async (req, res) => {
  const user = overlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const { text, voice, speed } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });
  try {
    const audio = await kitten.generateSpeech({ text, voice, speed });
    res.set("Content-Type", "audio/wav");
    res.send(audio);
  } catch (err) {
    sendWorkerError(res, err, "KittenTTS", kitten.maxTextChars, "kitten/.venv");
  }
});

// POST /overlay/tts/kokoro?token=... — { text, voice, speed? } → audio/wav.
// Same contract as /overlay/tts/kitten: OBS token auth, no aiLimiter.
router.post("/overlay/tts/kokoro", async (req, res) => {
  const user = overlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const { text, voice, speed } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });
  try {
    const audio = await kokoro.generateSpeech({ text, voice, speed });
    res.set("Content-Type", "audio/wav");
    res.send(audio);
  } catch (err) {
    sendWorkerError(res, err, "Kokoro", kokoro.maxTextChars, "kokoro");
  }
});

// POST /overlay/tts/fish?token=... — { text, voice, speed? } → audio/wav.
// Same contract as /overlay/tts/kokoro: OBS token auth, no aiLimiter (the
// upstream provider rate-limits by concurrency, and OBS speaks far more than
// the app's 5/min budget).
router.post("/overlay/tts/fish", async (req, res) => {
  const user = overlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  const { text, voice, speed } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ error: "text is required" });
  try {
    const audio = await fish.generateSpeech({ text, voice, speed });
    res.set("Content-Type", "audio/wav");
    res.send(audio);
  } catch (err) {
    sendFishError(res, err);
  }
});

// POST /overlay/tts/speaking/start|stop?token=... — the voice overlay brackets
// the audible window so the avatar overlay swaps to its speaking image at the
// same moment the app's own player used to (see /avatar/speaking/* above).
router.post("/overlay/tts/speaking/start", (req, res) => {
  const user = overlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  broadcastToAccount(user.twitchId, { type: "tts_state", playing: true });
  res.json({ ok: true });
});

router.post("/overlay/tts/speaking/stop", (req, res) => {
  const user = overlayUser(req);
  if (!user) return res.status(401).json({ error: "Not authorized" });
  broadcastToAccount(user.twitchId, { type: "tts_state", playing: false });
  res.json({ ok: true });
});

module.exports = router;
