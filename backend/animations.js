// Ambient and reactive animations driving VTube Studio parameters.
// Three states: idle (breathing + blinks), thinking (eyes closed), speaking (head bob).

const { injectParam } = require("./vtube");

let state = "idle"; // "idle" | "thinking" | "speaking"

let idleLoopTimer  = null;
let blinkTimer     = null;
let headBobTimer   = null;
let idleT          = 0;
let headBobT       = 0;

// ── Idle ──────────────────────────────────────────────────────────────────────

function startIdle() {
  stopThinkingLoop();
  idleT = 0;
  clearTimeout(idleLoopTimer);
  clearTimeout(blinkTimer);
  tickIdle();
  scheduleBlink();
}

function stopIdle() {
  clearTimeout(idleLoopTimer);
  clearTimeout(blinkTimer);
  idleLoopTimer = blinkTimer = null;
}

function stopThinkingLoop() {
  clearTimeout(thinkingLoopTimer);
  thinkingLoopTimer = null;
}

function tickIdle() {
  idleT += 120;

  // Breathing — gentle pitch, 4-second period
  const breathe = Math.sin((idleT / 4000) * 2 * Math.PI) * 1.2;
  // Slow sway — subtle roll, 9-second period
  const sway    = Math.sin((idleT / 9000) * 2 * Math.PI + 1.5) * 0.7;
  // Head wander — very slow left/right drift, 12-second period
  const wander  = Math.sin((idleT / 12000) * 2 * Math.PI + 0.8) * 1.5;

  injectParam("FaceAngleX", breathe);
  injectParam("FaceAngleZ", sway);
  injectParam("FaceAngleY", wander);

  idleLoopTimer = setTimeout(tickIdle, 120);
}

function scheduleBlink() {
  blinkTimer = setTimeout(doBlink, 2500 + Math.random() * 3500);
}

function doBlink() {
  injectParam("EyeOpenLeft",  0);
  injectParam("EyeOpenRight", 0);
  setTimeout(() => {
    injectParam("EyeOpenLeft",  1);
    injectParam("EyeOpenRight", 1);
    if (state === "idle") scheduleBlink();
  }, 100 + Math.random() * 50);
}

// ── Thinking ──────────────────────────────────────────────────────────────────

let thinkingLoopTimer = null;
let thinkingT = 0;

function startThinking() {
  state = "thinking";
  stopIdle();
  clearTimeout(headBobTimer);
  clearTimeout(thinkingLoopTimer);
  thinkingT = 0;
  tickThinking();
}

function tickThinking() {
  thinkingT += 120;

  // Eyes stay mostly closed with a tiny variation so they don't look frozen
  const eyeVal = 0.06 + Math.sin((thinkingT / 3000) * 2 * Math.PI) * 0.04;
  injectParam("EyeOpenLeft",  eyeVal);
  injectParam("EyeOpenRight", eyeVal);

  // Slow subtle head drift — like looking inward / searching for an answer
  const x = -2.5 + Math.sin((thinkingT / 5000) * 2 * Math.PI) * 0.6;
  const y = Math.sin((thinkingT / 7000) * 2 * Math.PI) * 1.2;
  const z = Math.sin((thinkingT / 9000) * 2 * Math.PI + 1) * 0.5;
  injectParam("FaceAngleX", x);
  injectParam("FaceAngleY", y);
  injectParam("FaceAngleZ", z);

  thinkingLoopTimer = setTimeout(tickThinking, 120);
}

function stopThinking() {
  if (state !== "thinking") return;
  clearTimeout(thinkingLoopTimer);
  thinkingLoopTimer = null;
  state = "idle";
  injectParam("EyeOpenLeft",  1);
  injectParam("EyeOpenRight", 1);
  injectParam("FaceAngleX",   0);
  injectParam("FaceAngleY",   0);
  injectParam("FaceAngleZ",   0);
  startIdle();
}

// ── Speaking ──────────────────────────────────────────────────────────────────

function startSpeaking() {
  state = "speaking";
  stopIdle();
  stopThinkingLoop();
  clearTimeout(headBobTimer);

  injectParam("EyeOpenLeft",  1);
  injectParam("EyeOpenRight", 1);

  headBobT = Math.random() * 1000; // random phase — feels more natural
  tickHeadBob();
}

function stopSpeaking() {
  state = "idle";
  clearTimeout(headBobTimer);
  headBobTimer = null;

  // Return head to neutral before resuming idle
  injectParam("FaceAngleY", 0);
  injectParam("FaceAngleZ", 0);
  injectParam("FaceAngleX", 0);
  startIdle();
}

function tickHeadBob() {
  headBobT += 90;

  // Left-right emphasis nod — two overlapping sine waves for organic feel
  const y = Math.sin((headBobT / 1000) * 2 * Math.PI) * 3.5
          + Math.sin((headBobT /  400) * 2 * Math.PI) * 1.2;
  // Subtle roll that mirrors the yaw, with a tiny noise
  const z = Math.sin((headBobT / 1400) * 2 * Math.PI) * 1.5
          + (Math.random() - 0.5) * 0.5;
  // Very slight pitch for liveliness
  const x = Math.sin((headBobT /  700) * 2 * Math.PI) * 0.8;

  injectParam("FaceAngleY", y);
  injectParam("FaceAngleZ", z);
  injectParam("FaceAngleX", x);

  headBobTimer = setTimeout(tickHeadBob, 90);
}

// Boot into idle — injectParam no-ops until VTS is authenticated
startIdle();

module.exports = { startThinking, stopThinking, startSpeaking, stopSpeaking };
