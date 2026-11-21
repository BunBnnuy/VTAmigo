// Three.js stage for the VRM lip-sync lab: loads a .vrm, renders it in a
// transparent canvas, and drives the five VRM vowel expressions from the
// timeline the backend derives from Piper's phonemes.
//
// React owns no three.js objects — it mounts the canvas and calls into this
// class, so a 60 fps render loop never schedules a re-render.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from "@pixiv/three-vrm-animation";
import {
  VISEME_NAMES,
  base64ToBlob,
  emptyWeights,
  sampleTimeline,
  smoothWeights,
} from "./visemeTimeline.js";
import { sampleAct, sampleIdle } from "./performance.js";

const smooth = (x) => x * x * (3 - 2 * x);

const BLINK_DURATION = 0.13;

export class VrmStage {
  constructor(container) {
    this.container = container;
    this.vrm = null;
    this.modelName = "";
    this.timeline = [];
    this.duration = 0;
    this.audio = null;
    this.audioUrl = null;
    this.volume = 1; // 0..1, scaled by the caller from the mixer gains
    this.rate = 1; // playback rate, like the app's TTS player
    this._playDone = null;
    this.weights = emptyWeights();
    this.nextBlink = 2 + Math.random() * 3;
    this.blinkElapsed = -1;
    this.onFrame = null;
    this.onState = null;
    this.preview = null; // forced viseme name while silent (lab buttons)
    this._lastFrameAt = 0;

    // Performance layer: idle + text-driven acts (see performance.js).
    this.act = "neutral";
    this.actStartedAt = 0;
    this.facing = 1; // VRM 0.x faces -Z in rig space; pitch/roll signs flip
    this.animBones = [];
    this.basePose = new Map();
    this.armInfo = { left: null, right: null };
    this._emotionName = null;

    // VRMA clips: one loader for the catalogue, one mixer per model.
    this.animLoader = new GLTFLoader();
    this.animLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    this.animCache = new Map(); // file → VRMAnimation
    this.mixer = null;
    this.clipAction = null;
    this.activeClip = null; // catalogue entry
    this.actClips = {}; // act → [entries]
    this.talkClips = []; // generic gestures used while speaking
    this._lastTalkId = null;
    this._nextGestureAt = 0;
    this.idleClip = null; // looping entry used while silent
    this.autoClips = true; // let acts pick their clip when one exists
    this.idlePool = []; // looping entries for "variar idle"
    this.idleRotation = false;
    this._nextIdleAt = 0;
    this.clipBlend = null; // { from: Map<node, Quaternion>, start }
    this._clipToken = 0;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
    this.camera.position.set(0, 1.3, 1.5);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.3, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 6;
    this.controls.maxPolarAngle = Math.PI * 0.62;

    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a3a, 1.6);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(1.2, 2.2, 1.8);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.9);
    fill.position.set(-2, 1.2, -1.4);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xf0429b, 0.8);
    rim.position.set(-0.6, 1.8, -2.2);
    this.scene.add(rim);

    this.clock = new THREE.Clock();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this._tick = this._tick.bind(this);
    this.renderer.setAnimationLoop(this._tick);
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ── Model ─────────────────────────────────────────────────────────────────

  async loadModel(source, name = "modelo.vrm") {
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    const isTempUrl = typeof source !== "string";

    try {
      const gltf = await new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        loader.load(
          url,
          resolve,
          (event) => {
            if (!event.total) return;
            this.onState?.({ type: "load-progress", progress: event.loaded / event.total });
          },
          reject
        );
      });

      const vrm = gltf.userData.vrm;
      if (!vrm) throw new Error("El archivo no contiene un VRM válido");

      if (vrm.meta?.metaVersion === "0") VRMUtils.rotateVRM0(vrm);
      vrm.scene.traverse((obj) => {
        obj.frustumCulled = false; // spring bones can push vertices outside the bind-pose bounds
      });

      this.unloadModel();
      this.vrm = vrm;
      this.modelName = name;
      this.scene.add(vrm.scene);
      if (vrm.lookAt) vrm.lookAt.target = this.camera;
      this.poseArmsDown(vrm);
      this.captureBasePose(vrm);
      // Push the pose to the raw bones before measuring, so the bbox reflects
      // the lowered arms instead of whatever bind pose the file shipped with.
      vrm.humanoid?.update();
      vrm.scene.updateMatrixWorld(true);

      this.frameCamera(vrm);
      if (this.idleClip) this.playAnimation(this.idleClip).catch(() => {});
      this.onState?.({
        type: "model-loaded",
        name,
        version: vrm.meta?.metaVersion === "0" ? "VRM 0.x" : "VRM 1.0",
        expressions: this.expressionNames(vrm),
      });
      return vrm;
    } finally {
      if (isTempUrl) URL.revokeObjectURL(url);
    }
  }

  expressionNames(vrm) {
    const manager = vrm.expressionManager;
    if (!manager) return [];
    return manager.expressions.map((e) => e.expressionName);
  }

  frameCamera(vrm) {
    const head = vrm.humanoid?.getNormalizedBoneNode("head");
    const headPos = new THREE.Vector3();
    if (head) head.getWorldPosition(headPos);

    const box = new THREE.Box3().setFromObject(vrm.scene);
    const top = box.max.y || 1.6;
    const height = Math.max(0.5, (box.max.y || 1.6) - (box.min.y || 0));

    // Bust framing from the model's own proportions instead of a fixed
    // distance: chibi/stylised models have much bigger heads, and a fixed
    // head-height multiplier either crops their hair or makes a normal model
    // fill the screen with its chin.
    const visible = height * 0.55;
    const distance = visible / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    const targetY = top - visible * 0.42;

    this.controls.target.set(headPos.x, targetY, headPos.z);
    this.camera.position.set(headPos.x, targetY + visible * 0.02, headPos.z + distance);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  // VRM files ship in their bind pose (T, A or V) and this lab has no idle
  // animation, so the arms are lowered once. The rotation comes from the
  // actual bone direction in the humanoid rig's canonical space: hardcoded
  // local angles flip for VRM 0.x (rotateVRM0 turns the scene 180°) and can
  // push raised arms further up instead of down.
  poseArmsDown(vrm) {
    const humanoid = vrm.humanoid;
    if (!humanoid) return;

    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    for (const side of ["left", "right"]) {
      const upper = humanoid.getNormalizedBoneNode(`${side}UpperArm`);
      const lower = humanoid.getNormalizedBoneNode(`${side}LowerArm`);
      if (!upper || !lower) continue;

      upper.getWorldPosition(from);
      lower.getWorldPosition(to);
      const dir = to.sub(from).normalize();
      if (dir.y < -0.3) continue; // already resting down — respect the pose

      const sx = Math.sign(dir.x) || (side === "left" ? 1 : -1);
      const target = new THREE.Vector3(sx * 0.25, -1, 0).normalize();
      const delta = new THREE.Quaternion().setFromUnitVectors(dir, target);

      // The bone's rest orientation is baked into its parent chain, so a
      // rig-space premultiply rotates in the parent's frame and can send the
      // arm the other way. Convert the world-space delta to a local one:
      // L' = P⁻¹ · delta · P · L.
      const parentWorld = new THREE.Quaternion();
      upper.parent.getWorldQuaternion(parentWorld);
      const local = parentWorld
        .clone()
        .invert()
        .multiply(delta)
        .multiply(parentWorld)
        .multiply(upper.quaternion);
      upper.quaternion.copy(local);
    }
  }

  // ── Performance layer ─────────────────────────────────────────────────────

  // Snapshot of the (already arm-lowered) pose plus each arm's rest direction.
  // Every frame starts from this snapshot, so idle and act rotations never
  // accumulate and a gesture can fade out without leaving the arm somewhere.
  captureBasePose(vrm) {
    this.facing = vrm.meta?.metaVersion === "0" ? -1 : 1;
    this.animBones = [];
    this.basePose.clear();
    this.armInfo = { left: null, right: null };
    this._emotionName = null;

    // Every normalized bone: VRMA clips animate fingers/legs too, and they
    // must return to the rest pose when a clip stops.
    const rig = vrm.humanoid?.normalizedHumanBonesRoot;
    rig?.traverse((node) => {
      this.basePose.set(node, node.quaternion.clone());
      this.animBones.push(node);
    });

    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    for (const side of ["left", "right"]) {
      const upper = vrm.humanoid?.getNormalizedBoneNode(`${side}UpperArm`);
      const lower = vrm.humanoid?.getNormalizedBoneNode(`${side}LowerArm`);
      if (!upper || !lower) continue;
      upper.getWorldPosition(from);
      lower.getWorldPosition(to);
      const dir = to.sub(from).normalize();
      this.armInfo[side] = {
        upper,
        lower,
        sign: Math.sign(dir.x) || (side === "left" ? 1 : -1),
      };
    }
  }

  _bone(name) {
    return this.vrm?.humanoid?.getNormalizedBoneNode(name) || null;
  }

  _resetPose() {
    for (const [node, quat] of this.basePose) node.quaternion.copy(quat);
  }

  // Rotations are authored around world axes (pitch = X, yaw = Y, roll = Z)
  // and converted into the bone's local frame, because the rig's rest
  // orientation is baked into the parent chain.
  _applyWorldDelta(node, pitch, yaw, roll) {
    if (!node || (!pitch && !yaw && !roll)) return;
    const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "XYZ"));
    const parentWorld = new THREE.Quaternion();
    node.parent.getWorldQuaternion(parentWorld);
    node.quaternion.copy(
      parentWorld.clone().invert().multiply(delta).multiply(parentWorld).multiply(node.quaternion)
    );
  }

  // Points the upper arm at `angle` radians from straight down, in the frontal
  // plane, optionally bending the elbow. `sign` comes from the model so VRM 0.x
  // mirroring doesn't send the arm across the body.
  _aimArm(info, angle, bend) {
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    info.upper.getWorldPosition(from);
    info.lower.getWorldPosition(to);
    const dir = to.sub(from).normalize();

    const target = new THREE.Vector3(
      info.sign * Math.sin(angle),
      -Math.cos(angle),
      0
    ).normalize();
    const delta = new THREE.Quaternion().setFromUnitVectors(dir, target);

    const parentWorld = new THREE.Quaternion();
    info.upper.parent.getWorldQuaternion(parentWorld);
    info.upper.quaternion.copy(
      parentWorld.clone().invert().multiply(delta).multiply(parentWorld).multiply(info.upper.quaternion)
    );

    if (bend) {
      this._applyWorldDelta(info.lower, 0, 0, info.sign * bend);
    }
  }

  _applyIdle(seconds, speaking = false) {
    const idle = sampleIdle(seconds);
    const f = this.facing;
    // A slight head sway while talking makes speech readable even on models
    // whose mouth morph is tiny at OBS scale.
    const talk = speaking
      ? {
          pitch: Math.sin(seconds * 2.1) * 0.02,
          yaw: Math.sin(seconds * 1.3) * 0.028,
          roll: Math.sin(seconds * 1.7) * 0.012,
        }
      : { pitch: 0, yaw: 0, roll: 0 };
    this._applyWorldDelta(this._bone("spine"), idle.spine.pitch * f, 0, idle.spine.roll * f);
    this._applyWorldDelta(
      this._bone("head"),
      (idle.head.pitch + talk.pitch) * f,
      (idle.head.yaw + talk.yaw) * f,
      (idle.head.roll + talk.roll) * f
    );
  }

  // Applies one act and returns the facial expression to add on top of the
  // visemes (kept separate so lip-sync always wins the mouth).
  _applyAct(act, elapsed, withBody = true) {
    const perf = sampleAct(act, elapsed);
    if (withBody) {
      const f = this.facing;
      this._applyWorldDelta(this._bone("spine"), perf.spine.pitch * f, 0, perf.spine.roll * f);
      this._applyWorldDelta(this._bone("chest"), perf.spine.pitch * 0.35 * f, 0, 0);
      this._applyWorldDelta(
        this._bone("head"),
        perf.head.pitch * f,
        perf.head.yaw * f,
        perf.head.roll * f
      );

      if (perf.arm) {
        const info = this.armInfo[perf.arm.side];
        if (info) this._aimArm(info, perf.arm.angle, perf.arm.bend);
      }
    }
    return { expression: perf.expression, weight: perf.weight };
  }

  // ── VRMA clips ────────────────────────────────────────────────────────────

  // entries come from public/vrm-lab/animations.json.
  preloadClips(entries) {
    for (const entry of entries || []) this._loadAnimation(entry).catch(() => {});
  }

  setClipCatalog({ actClips, talkClips, idleClip, autoClips } = {}) {
    if (actClips) this.actClips = actClips;
    if (talkClips) this.talkClips = talkClips;
    if (idleClip !== undefined) this.idleClip = idleClip;
    if (autoClips !== undefined) this.autoClips = autoClips;
  }

  async _loadAnimation(entry) {
    const cached = this.animCache.get(entry.file);
    if (cached) return cached;
    const gltf = await this.animLoader.loadAsync(entry.file);
    const anim = gltf.userData.vrmAnimations?.[0];
    if (!anim) throw new Error("sin datos de animación VRM");
    this.animCache.set(entry.file, anim);
    return anim;
  }

  async playAnimation(entry, options = {}) {
    if (!this.vrm) throw new Error("carga un modelo antes de reproducir animaciones");
    const token = ++this._clipToken;
    let anim;
    try {
      anim = await this._loadAnimation(entry);
    } catch (err) {
      if (token === this._clipToken) {
        this.onState?.({ type: "error", message: `No se pudo cargar «${entry.label}»: ${err.message}` });
      }
      return;
    }
    if (token !== this._clipToken || !this.vrm) return;

    // Clips bind to normalized bones, so retargeting across models is handled
    // by three-vrm; one clip per model has to be rebuilt when the model changes.
    const clip = createVRMAnimationClip(anim, this.vrm);
    if (!this.mixer) {
      this.mixer = new THREE.AnimationMixer(this.vrm.scene);
      this.mixer.addEventListener("finished", (event) => {
        if (event.action !== this.clipAction) return;
        this._endClip();
      });
    }

    const action = this.mixer.clipAction(clip);
    const loop = options.loop != null ? options.loop : !!entry.loop;
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    if (this.clipAction && this.clipAction !== action) this.clipAction.fadeOut(0.25);
    action.fadeIn(0.2).play();

    this.clipAction = action;
    this.activeClip = entry;
    this.clipBlend = null;
    // Schedule the next talking gesture while this one plays.
    this._nextGestureAt = performance.now() + 5200 + Math.random() * 1800;
    this.onState?.({ type: "clip", id: entry.id, label: entry.label });
  }

  // Stops the current clip and blends the procedural pose back in, so a clip
  // that ends mid-pose never snaps.
  stopAnimation(blend = true) {
    this._clipToken++;
    if (!this.clipAction) {
      this.activeClip = null;
      return;
    }
    if (blend) {
      this.clipBlend = {
        from: new Map(this.animBones.map((node) => [node, node.quaternion.clone()])),
        start: performance.now(),
      };
    } else {
      this.clipBlend = null;
    }
    this.clipAction.fadeOut(0.15);
    this.clipAction = null;
    this.activeClip = null;
    this.onState?.({ type: "clip", id: null });
  }

  _endClip() {
    if (!this.clipAction) return;
    this.stopAnimation(true);
    if (this.isSpeaking) {
      // A short pause between gestures; the idle/procedural pose fills it.
      this._nextGestureAt = performance.now() + 1800 + Math.random() * 1400;
    } else if (this.idleClip) {
      this.playAnimation(this.idleClip);
    }
  }

  // Every ~25-40 s the idle swaps to another looping clip from the pool, so a
  // stream that sits between lines still looks alive.
  setIdleRotation(enabled, pool = []) {
    this.idleRotation = !!enabled;
    this.idlePool = pool;
    this._nextIdleAt = performance.now() + 18000;
  }

  setIdleClip(entry) {
    this.idleClip = entry || null;
    this._nextIdleAt = performance.now() + 22000 + Math.random() * 14000;
    if (!entry) {
      if (!this.isSpeaking && this.activeClip?.loop) this.stopAnimation();
      return;
    }
    if (!this.isSpeaking && this.vrm) this.playAnimation(entry).catch(() => {});
  }

  setAutoClips(enabled) {
    this.autoClips = !!enabled;
  }

  // Manual act preview (the "Actitud" selector) while silent.
  setAct(act) {
    this.act = act || "neutral";
    this.actStartedAt = performance.now();
  }

  unloadModel() {
    if (!this.vrm) return;
    this.stopAnimation(false);
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.activeClip = null;
    this.clipBlend = null;
    this.scene.remove(this.vrm.scene);
    VRMUtils.deepDispose(this.vrm.scene);
    this.vrm = null;
    this.basePose.clear();
    this.animBones = [];
    this.armInfo = { left: null, right: null };
  }

  // ── Speech ────────────────────────────────────────────────────────────────

  async synthesize(text, voice, provider = "piper") {
    const res = await fetch("/tts/visemes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ text, voice, provider }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `El servidor respondió ${res.status}`);
    return data;
  }

  async speak(text, voice, act, provider = "piper") {
    this.stop(false);
    const data = await this.synthesize(text, voice, provider);
    this.play(data, act);
    return data;
  }

  play(data, act) {
    this.stop(false);
    // Resolves when this particular clip finishes (or is stopped), so an
    // overlay can keep its own queue sequential.
    const done = new Promise((resolve) => {
      this._playDone = resolve;
    });
    this.act = act || "neutral";
    this.actStartedAt = performance.now();

    // An act with a VRMA clip replaces the procedural gesture; otherwise the
    // body goes back to idle + procedural act.
    const actPool = this.autoClips && act ? this.actClips[act] : null;
    // An act without its own clips still gets a generic talking gesture: a
    // long AI answer classified as "neutral" or "question" used to stand
    // completely still except for the mouth.
    const pool = actPool?.length ? actPool : this.autoClips ? this.talkClips : [];
    if (pool.length) {
      // Different takes keep repeated lines from looking identical.
      const entry = pool[Math.floor(Math.random() * pool.length)];
      this._lastTalkId = entry.id;
      this.playAnimation(entry, { loop: false }).catch((err) => {
        this.onState?.({ type: "error", message: err.message });
      });
    } else {
      this.stopAnimation(false);
    }

    this.timeline = data.visemes || [];
    this.duration = data.duration || 0;

    if (!data.audio) {
      this.onState?.({ type: "playing", duration: 0 });
      this._finishPlayback();
      return done;
    }

    const blob = base64ToBlob(data.audio, data.mime);
    this.audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(this.audioUrl);
    audio.preload = "auto";
    audio.volume = this.volume;
    audio.playbackRate = this.rate;
    this.audio = audio;

    audio.addEventListener("ended", () => {
      if (this.audio !== audio) return;
      this.onState?.({ type: "ended" });
      this._finishPlayback();
      // Hold the last pose for a moment, then release the URL. The timeline
      // sampler ramps to zero on its own because currentTime stops moving.
      window.setTimeout(() => {
        if (this.audio === audio) this.stop();
      }, 250);
    });
    audio.addEventListener("error", () => {
      // Clearing src on teardown fires a spurious error; only a live element's
      // failure is worth showing.
      if (this.audio !== audio) return;
      this.onState?.({ type: "error", message: "No se pudo reproducir el audio" });
    });

    this.onState?.({ type: "playing", duration: this.duration });
    audio.play().catch((err) => {
      // Autoplay policy: the click that started synthesis should still count,
      // but a blocked play() must surface instead of failing silently.
      this.onState?.({ type: "error", message: `Reproducción bloqueada: ${err.message}` });
      this._finishPlayback();
    });
    return done;
  }

  // The viseme sampler reads audio.currentTime (media time), so changing the
  // playback rate keeps the mouth in sync.
  setRate(value) {
    const v = Math.min(2, Math.max(0.5, Number(value) || 1));
    this.rate = v;
    if (this.audio) this.audio.playbackRate = v;
  }

  // 0..1. Applied live so a mixer slider move is heard on the current clip.
  setVolume(value) {
    const v = Math.min(1, Math.max(0, Number(value) || 0));
    this.volume = v;
    if (this.audio) this.audio.volume = v;
  }

  _finishPlayback() {
    const done = this._playDone;
    this._playDone = null;
    if (done) done();
  }

  stop(resumeIdle = true) {
    const audio = this.audio;
    this.audio = null;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load(); // aborts any in-flight buffering
    }
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
    this.timeline = [];
    this.duration = 0;
    this.act = "neutral";
    this.actStartedAt = performance.now();
    this._finishPlayback();
    this.stopAnimation(true);
    if (resumeIdle && this.idleClip && this.vrm) {
      this.playAnimation(this.idleClip).catch(() => {});
    }
    this.onState?.({ type: "stopped" });
  }

  get isSpeaking() {
    return !!this.audio && !this.audio.paused && !this.audio.ended;
  }

  // Force one viseme while silent (the A/E/I/O/U chips); null returns to
  // idle. Speech ignores it, so a preview never fights a running timeline.
  setPreview(name) {
    this.preview = name || null;
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  _tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.controls.update();

    const speaking = this.isSpeaking;
    const now = performance.now();

    // While a long answer plays, keep the body gesturing every ~6-8 s.
    if (
      speaking &&
      this.autoClips &&
      !this.clipAction &&
      this.talkClips.length &&
      now >= this._nextGestureAt
    ) {
      this._nextGestureAt = now + 6200 + Math.random() * 2400;
      const pool = this.talkClips.filter((entry) => entry.id !== this._lastTalkId);
      const entry = (pool.length ? pool : this.talkClips)[
        Math.floor(Math.random() * (pool.length || this.talkClips.length))
      ];
      this._lastTalkId = entry.id;
      this.playAnimation(entry, { loop: false }).catch(() => {});
    }

    if (this.idleRotation && !speaking && this.idlePool.length > 1 && now >= this._nextIdleAt) {
      this._nextIdleAt = now + 22000 + Math.random() * 16000;
      const pick = this.idlePool[Math.floor(Math.random() * this.idlePool.length)];
      if (pick.id !== this.activeClip?.id) this.playAnimation(pick).catch(() => {});
    }

    const t = speaking ? this.audio.currentTime : -1;
    let target = speaking ? sampleTimeline(this.timeline, t) : emptyWeights();

    // Manual preview (the A/E/I/O/U buttons) only applies while silent —
    // real speech always wins so the two never fight.
    if (!speaking && this.preview) {
      target = emptyWeights();
      target[this.preview] = 1;
    }

    smoothWeights(this.weights, target, dt, 0.035);

    if (this.vrm) {
      const actElapsed = speaking ? this.audio.currentTime : (now - this.actStartedAt) / 1000;
      let emotion;

      if (this.clipAction) {
        // The mixer drives the normalized bones; the procedural layer stays
        // out of its way, but facial expressions keep running on top.
        this.mixer.update(dt);
        emotion = this._applyAct(this.act, actElapsed, false);
      } else {
        this._resetPose();
        this._applyIdle(now / 1000, speaking);
        emotion = this._applyAct(this.act, actElapsed, true);

        // Blending back from the last clip pose to the procedural one.
        if (this.clipBlend) {
          const k = smooth(Math.min(1, (now - this.clipBlend.start) / 280));
          if (k >= 1) {
            this.clipBlend = null;
          } else {
            for (const [node, quat] of this.clipBlend.from) {
              node.quaternion.slerp(quat, 1 - k);
            }
          }
        }
      }

      const manager = this.vrm.expressionManager;
      if (manager) {
        const open = 1 - this.weights.close;
        for (const name of VISEME_NAMES) {
          manager.setValue(name, this.weights[name] * open);
        }
        manager.setValue("blink", this._blinkValue(dt));

        // Expression presets are applied on top of the visemes; a previous
        // act's expression is cleared only when the act changes.
        if (this._emotionName && this._emotionName !== emotion.expression) {
          manager.setValue(this._emotionName, 0);
        }
        if (emotion.expression) {
          manager.setValue(emotion.expression, emotion.weight);
        }
        this._emotionName = emotion.expression;
      }
      this.vrm.update(dt);
    }

    this.renderer.render(this.scene, this.camera);

    if (this.onFrame && now - this._lastFrameAt > 80) {
      this._lastFrameAt = now;
      this.onFrame({
        t: speaking ? t : 0,
        duration: this.duration,
        speaking,
        weights: { ...this.weights },
      });
    }
  }

  _blinkValue(dt) {
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blinkElapsed < 0) {
      this.blinkElapsed = 0;
      this.nextBlink = 2 + Math.random() * 4;
    }
    if (this.blinkElapsed < 0) return 0;
    this.blinkElapsed += dt;
    const p = this.blinkElapsed / BLINK_DURATION;
    if (p >= 1) {
      this.blinkElapsed = -1;
      return 0;
    }
    return Math.sin(Math.min(1, p) * Math.PI);
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.idleClip = null;
    this.stop(false);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.unloadModel();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
