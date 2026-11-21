import { useEffect, useRef, useState } from "react";
import { VrmStage } from "../vrmLab/VrmStage.js";
import { actFor } from "../vrmLab/performance.js";

// OBS browser source for the VRM avatar. Transparent canvas, no UI, own audio.
// It listens to the same `tts_speak` events the regular voice overlay uses, so
// the streamer only has to switch the app's voice output to "Overlay" (or
// "Both") and point OBS here instead of at the voice overlay.
//
// URL: /vrm-overlay.html?token=<overlay token>[&model=<url>][&debug=1]

const params = new URLSearchParams(window.location.search);
const TOKEN = params.get("token") || "";
const DEBUG = params.get("debug") === "1";
const ENC_TOKEN = encodeURIComponent(TOKEN);

function api(path) {
  return `${path}${path.includes("?") ? "&" : "?"}token=${ENC_TOKEN}`;
}

function providerVoice(item) {
  const provider = ["piper", "fish", "kitten", "kokoro"].includes(item.ttsProvider)
    ? item.ttsProvider
    : "piper";
  const voice =
    provider === "fish"
      ? item.fishVoice
      : provider === "kokoro"
        ? item.kokoroVoice
        : provider === "kitten"
          ? item.kittenVoice
          : item.piperVoice;
  return { provider, voice: voice || undefined };
}

export default function VrmOverlay() {
  const mountRef = useRef(null);
  const [wsGrace, setWsGrace] = useState(false);
  const [status, setStatus] = useState({
    ws: false,
    model: "",
    clip: "",
    error: "",
    speaking: false,
    queued: 0,
  });

  useEffect(() => {
    if (status.ws) {
      setWsGrace(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setWsGrace(true), 8000);
    return () => window.clearTimeout(timer);
  }, [status.ws]);

  useEffect(() => {
    const stage = new VrmStage(mountRef.current);
    window.__vrmOverlay = stage; // console access while tuning the overlay
    let disposed = false;
    let ws = null;
    let reconnectTimer = null;
    let mixer = {};
    let baseVolume = 1;
    let audiblySpeaking = false;
    let busy = false;
    const queue = [];

    const set = (patch) => {
      if (disposed) return;
      setStatus((prev) => ({ ...prev, ...patch }));
    };

    const applyVolume = () => {
      const bot = mixer.botVoice != null ? mixer.botVoice : 1;
      const master = mixer.master != null ? mixer.master : 1;
      stage.setVolume(baseVolume * bot * master);
    };

    stage.onState = (event) => {
      if (event.type === "playing") {
        if (!audiblySpeaking) {
          audiblySpeaking = true;
          set({ speaking: true });
          fetch(api("/overlay/tts/speaking/start"), { method: "POST" }).catch(() => {});
        }
      }
      if (event.type === "ended" || event.type === "stopped") {
        if (audiblySpeaking) {
          audiblySpeaking = false;
          set({ speaking: false });
          fetch(api("/overlay/tts/speaking/stop"), { method: "POST" }).catch(() => {});
        }
      }
      if (event.type === "model-loaded") set({ model: event.name, error: "" });
      if (event.type === "clip") set({ clip: event.label || "" });
      if (event.type === "error") {
        set({ error: event.message });
        console.warn("[vrm-overlay]", event.message);
      }
    };

    // ── Speaking queue ─────────────────────────────────────────────────────
    async function speak(item) {
      const { provider, voice } = providerVoice(item);
      baseVolume = item.volume != null ? item.volume : 1;
      applyVolume();
      stage.setRate(item.rate || 1);

      const res = await fetch(api("/overlay/tts/visemes"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: item.text,
          voice,
          provider,
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error || `TTS respondió ${res.status}`);
      }
      const data = await res.json();
      await stage.play(data, actFor(item.text));
    }

    async function pump() {
      if (busy || disposed) return;
      if (!queue.length) {
        set({ queued: 0 });
        return;
      }
      busy = true;
      const item = queue.shift();
      set({ queued: queue.length });
      try {
        await speak(item);
      } catch (err) {
        console.warn("[vrm-overlay] no se pudo hablar:", err.message);
        set({ error: err.message });
      }
      busy = false;
      pump();
    }

    function enqueue(item) {
      if (!item?.text) return;
      queue.push(item);
      set({ queued: queue.length });
      pump();
    }

    function skip() {
      queue.length = 0;
      set({ queued: 0 });
      stage.stop();
    }

    // ── WebSocket ──────────────────────────────────────────────────────────
    function connect() {
      if (disposed) return;
      const proto = window.location.protocol === "https:" ? "wss://" : "ws://";
      ws = new WebSocket(`${proto}${window.location.host}/chat?token=${ENC_TOKEN}`);
      ws.onopen = () => set({ ws: true });
      ws.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (data.type === "tts_speak") enqueue(data);
        else if (data.type === "tts_skip") skip();
        else if (data.type === "mixer_state" && data.mixer) {
          mixer = data.mixer;
          applyVolume();
        }
      };
      ws.onclose = () => {
        set({ ws: false });
        ws = null;
        if (!disposed) reconnectTimer = window.setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };
    }

    // ── Boot: mixer, config, catalogue, model, socket ──────────────────────
    (async () => {
      if (!TOKEN) {
        set({ error: "falta ?token= en la URL" });
        console.error("[vrm-overlay] missing token");
        return;
      }

      fetch(api("/mixer/state"))
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.mixer) mixer = d.mixer;
          applyVolume();
        })
        .catch(() => {});

      let config = null;
      try {
        const res = await fetch(api("/overlay/vrm/config"));
        if (res.ok) config = await res.json();
      } catch (err) {
        console.warn("[vrm-overlay] config:", err.message);
      }

      let clips = [];
      try {
        const res = await fetch("/vrm-lab/animations.json");
        if (res.ok) clips = await res.json();
      } catch {
        /* catalogue is optional */
      }
      clips = clips.map((clip) => ({ ...clip, file: `/vrm-lab/${clip.file}` }));

      const modelUrl = params.get("model") || config?.modelUrl || "";
      if (modelUrl) {
        try {
          await stage.loadModel(modelUrl, modelUrl.split("/").pop() || "modelo.vrm");
        } catch (err) {
          set({ error: `modelo: ${err.message}` });
          console.error("[vrm-overlay] no se pudo cargar el modelo:", err.message);
        }
      } else {
        set({ error: "sin modelo configurado (carga uno por URL en el lab)" });
      }

      if (disposed) return;

      const actClips = {};
      for (const clip of clips) {
        for (const act of clip.acts || []) (actClips[act] ||= []).push(clip);
      }
      stage.setClipCatalog({
        actClips,
        talkClips: clips.filter((clip) => clip.talk),
        autoClips: config?.autoClips !== false,
      });
      stage.preloadClips(clips.filter((clip) => clip.acts?.length));

      const idle = clips.find((clip) => clip.id === config?.idleClip);
      if (idle) stage.setIdleClip(idle);
      if (config?.varyIdle) {
        stage.setIdleRotation(true, clips.filter((clip) => clip.category === "idle"));
      }

      connect();
    })();

    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }
      queue.length = 0;
      stage.dispose();
      delete window.__vrmOverlay;
    };
  }, []);

  return (
    <div className="vrmOverlayRoot">
      <div ref={mountRef} className="vrmOverlayCanvas" />
      {!status.ws && status.model && wsGrace && (
        <div className="vrmOverlayAlert">VRM overlay: sin conexión con el chat</div>
      )}
      {DEBUG && (
        <div className="vrmOverlayHud">
          <div>
            WS {status.ws ? "✓" : "…"} · modelo {status.model || "—"} · cola {status.queued}
          </div>
          <div>{status.speaking ? `hablando${status.clip ? ` · ${status.clip}` : ""}` : "en silencio"}</div>
          {status.error && <div className="isError">{status.error}</div>}
        </div>
      )}
    </div>
  );
}
