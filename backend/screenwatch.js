// Screen question watcher — periodically screenshots + OCRs the screen (local,
// free), and only when the text changed and looks like a question does it ask
// the vision model to extract { question, options }. Detected questions are
// handed to onQuestion; the frontend collects chat and requests the answer.
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const { extractScreenQuestion } = require("./claude");

const SCRIPT = path.join(__dirname, "screenwatch.ps1");
const CLICK_SCRIPT = path.join(__dirname, "screenclick.ps1");
const IMAGE_PATH = path.join(os.tmpdir(), "aicompanion-screenwatch.png");
// Separate file for manual scans so they never clobber an in-flight loop tick
const MANUAL_IMAGE_PATH = path.join(os.tmpdir(), "aicompanion-screenwatch-manual.png");
const CAPTURE_TIMEOUT_MS = 30000;

let running = false;
let timer = null;
let opts = {};
let lastText = "";
let lastQuestionKey = "";
let activeQuestionWords = null; // cooldown: words of the question currently on screen
let windowMissing = false; // target process window not found (log/notify once)

function normalize(t) {
  return (t || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function contentWords(t) {
  return normalize(t)
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(" ")
    .filter((w) => w.length > 2);
}

// True while most of the detected question's words are still visible in the OCR text
function stillOnScreen(ocrText, qWords) {
  if (!qWords || qWords.length === 0) return false;
  const t = normalize(ocrText).replace(/[^\p{L}\p{N} ]/gu, "");
  let hits = 0;
  for (const w of qWords) if (t.includes(w)) hits++;
  return hits / qWords.length >= 0.5;
}

// "x,y,w,h" → {x,y,w,h} or null (full primary screen)
function parseRegion(str) {
  if (!str || typeof str !== "string") return null;
  const parts = str.split(",").map((p) => parseInt(p.trim(), 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n)) || parts[2] <= 0 || parts[3] <= 0) return null;
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

// ── Auto-navigation (Majotori) ───────────────────────────────────────────────
// After a round, the results screen appears; clicking advances back to the
// main menu, where "Jugar" → "Solo Trivia" (+ one extra click) starts the next
// round. While "returning" (results → menu) a clicker clicks the window center
// every ~1 s until the tick loop sees the next screen and changes phase.
const RESULTS_WORDS = [
  "resultado", "resultados", "puntuacion", "puntuación", "aciertos",
  "correctas", "incorrectas", "game over", "fin de la partida",
];
const NAV_CLICK_MS = 1000;
const NAV_MAX_CLICKS = 90; // safety: give up after this many clicks in one phase

let navTimer = null;
let navPhase = ""; // "" | "returning"
let navBusy = false; // a nav click script is currently running
let navClicks = 0;

function classifyScreen(norm) {
  if (/\bsolo\s*trivia\b/.test(norm)) return "modeselect";
  if (/\bjugar\b/.test(norm)) return "menu";
  if (RESULTS_WORDS.some((w) => norm.includes(w))) return "results";
  return "unknown";
}

function navArgs() {
  const a = [];
  if (opts.processName) a.push("-ProcessName", opts.processName);
  if (opts.region) {
    a.push("-X", String(opts.region.x), "-Y", String(opts.region.y),
      "-W", String(opts.region.w), "-H", String(opts.region.h));
  }
  return a;
}

function navClickCenter() {
  return runClickScript(["-Center", "-Single", ...navArgs()], 20000);
}

function navClickText(text) {
  return runClickScript(["-TargetText", text, "-Single", ...navArgs()], 30000);
}

function startNavClicker(phase) {
  if (navTimer && navPhase === phase) return; // already clicking for this phase
  stopNavClicker();
  navPhase = phase;
  navClicks = 0;
  console.log(`[screenwatch] nav: ${phase} — clicking every ${NAV_CLICK_MS}ms`);
  opts.onStatus?.({ type: "navigating", phase });
  navTimer = setInterval(() => {
    if (navBusy) return; // previous click still in flight — skip this beat
    if (++navClicks > NAV_MAX_CLICKS) {
      console.log(`[screenwatch] nav: ${navPhase} — giving up after ${NAV_MAX_CLICKS} clicks`);
      stopNavClicker();
      return;
    }
    navBusy = true;
    navClickCenter()
      .catch((e) => console.error("[screenwatch] nav click:", e.message))
      .finally(() => { navBusy = false; });
  }, NAV_CLICK_MS);
}

function stopNavClicker() {
  if (navTimer) clearInterval(navTimer);
  navTimer = null;
  navPhase = "";
}

// One navigation step per tick, decided from the current OCR text
async function handleNavigation(norm) {
  const screen = classifyScreen(norm);
  if (screen === "modeselect") {
    stopNavClicker();
    try {
      await navClickText("solo trivia");
      console.log('[screenwatch] nav: clicked "Solo Trivia"');
      // One extra click is enough to land on the first question
      await new Promise((r) => setTimeout(r, 5000));
      await navClickCenter();
      console.log("[screenwatch] nav: advanced to questions");
    } catch (e) {
      console.error('[screenwatch] nav: click "Solo Trivia" failed:', e.message);
    }
  } else if (screen === "menu") {
    stopNavClicker();
    try {
      await navClickText("jugar");
      console.log('[screenwatch] nav: clicked "Jugar"');
    } catch (e) {
      console.error('[screenwatch] nav: click "Jugar" failed:', e.message);
    }
  } else if (screen === "results") {
    // Click until the results screen gives way to the main menu
    startNavClicker("returning");
  }
  // "unknown" (transition screens): leave any active clicker running
}

function captureAndOcr(region, processName, outFile = IMAGE_PATH) {
  return new Promise((resolve, reject) => {
    const args = [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", SCRIPT, "-OutFile", outFile,
    ];
    if (processName) args.push("-ProcessName", processName);
    if (region) {
      args.push("-X", String(region.x), "-Y", String(region.y), "-W", String(region.w), "-H", String(region.h));
    }
    const proc = spawn("powershell", args, { shell: false, windowsHide: true });
    let out = "";
    let err = "";
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error("Screenshot script timed out"));
    }, CAPTURE_TIMEOUT_MS);
    proc.stdout.on("data", (c) => { out += c.toString("utf8"); });
    proc.stderr.on("data", (c) => { err += c.toString("utf8"); });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 2 || err.includes("OCR_UNAVAILABLE")) return reject(new Error("OCR_UNAVAILABLE"));
      if (code === 3 || err.includes("WINDOW_NOT_FOUND")) return reject(new Error("WINDOW_NOT_FOUND"));
      if (code !== 0) return reject(new Error(err.trim() || `screenshot script exited with code ${code}`));
      resolve(out);
    });
    proc.on("error", (e) => { clearTimeout(timeout); reject(e); });
  });
}

async function tick() {
  try {
    const text = await captureAndOcr(opts.region, opts.processName);
    if (!running) return;

    if (windowMissing) {
      windowMissing = false;
      opts.onStatus?.({ type: "watching" });
    }

    // Cooldown: the question we already reported is still on screen
    if (activeQuestionWords) {
      if (stillOnScreen(text, activeQuestionWords)) return;
      activeQuestionWords = null;
    }

    const norm = normalize(text);
    const changed = !!norm && norm !== lastText;
    if (norm) lastText = norm;

    const looksLikeQuestion = /[?¿]/.test(text);

    // Auto-navigation: results → menu → "Jugar" → "Solo Trivia" → questions
    if (opts.autoNavigate) {
      if (looksLikeQuestion) {
        if (navPhase) {
          console.log("[screenwatch] nav: question visible — navigation done");
          stopNavClicker();
        }
      } else {
        await handleNavigation(norm);
        return; // no question on screen — nothing else to do this tick
      }
    }

    if (!changed) return; // nothing changed

    // Cheap gate: only bother the vision model if it plausibly shows a question
    if (!looksLikeQuestion) return;
    if (text.split(/\r?\n/).filter((l) => l.trim()).length < 3) return;

    opts.onStatus?.({ type: "analyzing" });
    const extracted = await extractScreenQuestion(IMAGE_PATH);
    opts.onStatus?.({ type: "watching" });
    if (!running) return;

    if (extracted.hasQuestion && extracted.question && extracted.options.length >= 2) {
      activeQuestionWords = contentWords(extracted.question);
      const key = normalize(extracted.question);
      if (key !== lastQuestionKey) {
        lastQuestionKey = key;
        opts.onQuestion?.({ question: extracted.question, options: extracted.options });
      }
    }
  } catch (err) {
    if (err.message === "OCR_UNAVAILABLE") {
      console.error("[screenwatch] No Windows OCR language pack available — stopping");
      opts.onStatus?.({ type: "error", message: "OCR no disponible en este Windows" });
      running = false;
      return;
    }
    if (err.message === "WINDOW_NOT_FOUND") {
      // Target app not running (yet) — keep watching, it may launch later
      if (!windowMissing) {
        windowMissing = true;
        console.log(`[screenwatch] window for "${opts.processName}" not found — waiting`);
        opts.onStatus?.({ type: "error", message: `No se encontró la ventana de ${opts.processName}` });
      }
    } else {
      console.error("[screenwatch]", err.message);
      opts.onStatus?.({ type: "error", message: err.message });
    }
  } finally {
    if (running) timer = setTimeout(tick, (opts.intervalSec || 4) * 1000);
  }
}

function start(config) {
  stop();
  opts = {
    intervalSec: Math.max(2, Number(config.intervalSec) || 4),
    region: parseRegion(config.region),
    processName: (config.processName || "").trim().replace(/\.exe$/i, ""),
    autoNavigate: !!config.autoNavigate,
    onQuestion: config.onQuestion,
    onStatus: config.onStatus,
  };
  running = true;
  lastText = "";
  lastQuestionKey = "";
  activeQuestionWords = null;
  windowMissing = false;
  stopNavClicker();
  opts.onStatus?.({ type: "watching" });
  timer = setTimeout(tick, 500);
  const target = opts.processName
    ? `window "${opts.processName}"${opts.region ? " + region" : ""}`
    : opts.region ? "region" : "full screen";
  console.log(`[screenwatch] started (every ${opts.intervalSec}s, ${target}${opts.autoNavigate ? ", auto-nav" : ""})`);
}

function stop() {
  if (running) console.log("[screenwatch] stopped");
  running = false;
  clearTimeout(timer);
  timer = null;
  stopNavClicker();
}

// Manual one-shot scan: capture + vision extraction, skipping the change and
// question-mark gates (the user explicitly asked to look now)
async function scanOnce(config = {}) {
  const region = parseRegion(config.region);
  const processName = (config.processName || "").trim().replace(/\.exe$/i, "");
  await captureAndOcr(region, processName, MANUAL_IMAGE_PATH);
  const extracted = await extractScreenQuestion(MANUAL_IMAGE_PATH);
  if (extracted.hasQuestion && extracted.question && extracted.options.length >= 2) {
    // Keep the background loop from re-firing this same question
    activeQuestionWords = contentWords(extracted.question);
    lastQuestionKey = normalize(extracted.question);
    return { hasQuestion: true, question: extracted.question, options: extracted.options };
  }
  return { hasQuestion: false };
}

function isRunning() {
  return running;
}

// Run screenclick.ps1 with extra args and map its exit codes to errors
function runClickScript(extraArgs, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const args = [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", CLICK_SCRIPT, ...extraArgs,
    ];
    const ps = spawn("powershell", args, { shell: false, windowsHide: true });
    let out = "";
    let err = "";
    const timeout = setTimeout(() => {
      ps.kill();
      reject(new Error("Click script timed out"));
    }, timeoutMs);
    ps.stdout.on("data", (c) => { out += c.toString("utf8"); });
    ps.stderr.on("data", (c) => { err += c.toString("utf8"); });
    ps.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 2 || err.includes("OCR_UNAVAILABLE")) return reject(new Error("OCR_UNAVAILABLE"));
      if (code === 3 || err.includes("WINDOW_NOT_FOUND")) return reject(new Error("WINDOW_NOT_FOUND"));
      if (code === 4 || err.includes("TEXT_NOT_FOUND")) return reject(new Error("TEXT_NOT_FOUND"));
      if (code !== 0) return reject(new Error(err.trim() || `click script exited with code ${code}`));
      resolve(out.trim());
    });
    ps.on("error", (e) => { clearTimeout(timeout); reject(e); });
  });
}

// Click an answer option on screen: OCR-locates the text, clicks it, waits
// 3-5 s and clicks the same spot again to advance to the next question.
// Never leave the game stuck on a question: on failure retry the exact text,
// then click the first option ("A)"), then double-click the window center.
async function clickOption({ optionText, processName, region, dryRun = false }) {
  const reg = parseRegion(region);
  const proc = (processName || "").trim().replace(/\.exe$/i, "");
  const common = [];
  if (proc) common.push("-ProcessName", proc);
  if (reg) common.push("-X", String(reg.x), "-Y", String(reg.y), "-W", String(reg.w), "-H", String(reg.h));
  if (dryRun) common.push("-DryRun");
  // Capture + OCR + click + 3-5 s advance delay + second click
  const attempt = (args) => runClickScript([...args, ...common], 45000);
  const pause = () => new Promise((r) => setTimeout(r, 600));

  try {
    return await attempt(["-TargetText", optionText]);
  } catch (e1) {
    // Fatal setup problems won't improve by retrying
    if (e1.message === "WINDOW_NOT_FOUND" || e1.message === "OCR_UNAVAILABLE") throw e1;

    if (e1.message !== "TEXT_NOT_FOUND") {
      // Transient failure (timeout, OCR hiccup) — retry the exact text once
      console.log(`[screenwatch] click "${optionText}" failed (${e1.message}) — retrying`);
      await pause();
      try {
        return await attempt(["-TargetText", optionText]);
      } catch (e2) {
        if (e2.message === "WINDOW_NOT_FOUND" || e2.message === "OCR_UNAVAILABLE") throw e2;
      }
    }

    // Couldn't click the chosen option — click the first option "A)" instead
    console.log(`[screenwatch] "${optionText}" not clickable — clicking first option "A)" instead`);
    await pause();
    try {
      return await attempt(["-FirstOption"]);
    } catch (e3) {
      if (e3.message === "WINDOW_NOT_FOUND" || e3.message === "OCR_UNAVAILABLE") throw e3;
      // Last resort: double-click the window center so the game moves on
      console.log("[screenwatch] first option not found either — clicking window center");
      await pause();
      return attempt(["-Center"]);
    }
  }
}

module.exports = { start, stop, isRunning, scanOnce, clickOption };
