import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Dices,
  Loader2,
  Play,
  Square,
  Upload,
  Volume2,
  Waves,
} from "lucide-react";
import { VrmStage } from "./VrmStage.js";
import { VISEME_COLORS, VISEME_NAMES } from "./visemeTimeline.js";
import { ACT_LABELS, actFor } from "./performance.js";
import { randomLine } from "./randomText.js";

const DEFAULT_TEXT =
  "Hola, soy tu cohost. Esta boca no adivina por volumen: cada visema sale de los fonemas que pronuncia la voz.";

const VISEME_LABEL = { aa: "A", ee: "E", ih: "I", oh: "O", ou: "U", close: "—" };

const CLIP_CATEGORIES = {
  idle: "En reposo",
  talk: "Hablar",
  greet: "Saludo",
  happy: "Alegría",
  think: "Pensar",
  thanks: "Gracias",
  sad: "Triste",
  angry: "Enfado",
  surprise: "Sorpresa",
  gesture: "Gestos",
};

export default function VRMLab() {
  const mountRef = useRef(null);
  const stageRef = useRef(null);
  const fileRef = useRef(null);
  const playheadRef = useRef(null);
  const weightsRef = useRef(null);
  const timeRef = useRef(null);

  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState("");
  const [provider, setProvider] = useState("piper");
  const [fishVoice, setFishVoice] = useState("");
  const [fishVoices, setFishVoices] = useState([]);
  const [fishConfigured, setFishConfigured] = useState(null);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [modelUrl, setModelUrl] = useState("");

  const [model, setModel] = useState(null);
  const [loadingModel, setLoadingModel] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [dragging, setDragging] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [speech, setSpeech] = useState(null);
  const [frame, setFrame] = useState({ t: 0, duration: 0, speaking: false });
  const [weights, setWeights] = useState({ aa: 0, ee: 0, ih: 0, oh: 0, ou: 0, close: 0 });
  const [preview, setPreview] = useState(null);
  const [actOverride, setActOverride] = useState("auto");
  const [lastAct, setLastAct] = useState(null);
  const [clips, setClips] = useState([]);
  const [idleClipId, setIdleClipId] = useState("");
  const [autoClips, setAutoClips] = useState(true);
  const [activeClipId, setActiveClipId] = useState(null);
  const [previewClipId, setPreviewClipId] = useState("");
  const [varyIdle, setVaryIdle] = useState(false);
  const [overlayUrl, setOverlayUrl] = useState("");
  const [overlayCopied, setOverlayCopied] = useState(false);

  // ── Stage lifecycle ───────────────────────────────────────────────────────
  useEffect(() => {
    const stage = new VrmStage(mountRef.current);
    stageRef.current = stage;
    window.__vrmLab = stage; // console access for tuning envelopes during dev

    stage.onState = (event) => {
      if (event.type === "load-progress") setLoadProgress(event.progress);
      if (event.type === "model-loaded") {
        setModel(event);
        setLoadingModel(false);
        setLoadProgress(0);
      }
      if (event.type === "error") setError(event.message);
      if (event.type === "clip") setActiveClipId(event.id);
    };
    stage.onFrame = (f) => {
      setFrame({ t: f.t, duration: f.duration, speaking: f.speaking });
      setWeights(f.weights);
      if (timeRef.current) {
        timeRef.current.textContent = `${f.t.toFixed(2)} / ${f.duration.toFixed(2)} s`;
      }
      if (playheadRef.current) {
        const pct = f.duration ? Math.min(100, (f.t / f.duration) * 100) : 0;
        playheadRef.current.style.left = `${pct}%`;
      }
      if (weightsRef.current) {
        for (const name of [...VISEME_NAMES, "close"]) {
          const el = weightsRef.current.querySelector(`[data-viseme="${name}"]`);
          if (el) el.style.transform = `scaleY(${Math.max(0.02, f.weights[name])})`;
        }
      }
    };

    return () => {
      stage.dispose();
      stageRef.current = null;
      delete window.__vrmLab;
    };
  }, []);

  // ── Persisted config + overlay URL ────────────────────────────────────────
  useEffect(() => {
    fetch("/vrm-lab/config", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => {
        if (!cfg) return;
        setIdleClipId(cfg.idleClip || "");
        setAutoClips(cfg.autoClips !== false);
        setVaryIdle(!!cfg.varyIdle);
        stageRef.current?.setAutoClips(cfg.autoClips !== false);
        if (cfg.modelUrl && stageRef.current) {
          setModelUrl(cfg.modelUrl);
          setLoadingModel(true);
          stageRef.current
            .loadModel(cfg.modelUrl, cfg.modelUrl.split("/").pop() || "modelo.vrm")
            .catch((err) => {
              setLoadingModel(false);
              setError(`No se pudo cargar el modelo guardado: ${err.message}`);
            });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/overlay/avatar/overlay-url", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.token) {
          setOverlayUrl(
            `${window.location.origin}/vrm-overlay.html?token=${encodeURIComponent(data.token)}`
          );
        }
      })
      .catch(() => {});
  }, []);

  const saveConfig = useCallback((patch) => {
    fetch("/vrm-lab/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(patch),
    }).catch(() => {});
  }, []);

  // ── VRMA catalogue ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/vrm-lab/animations.json", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => {
        if (cancelled || !Array.isArray(list)) return;
        const entries = list.map((c) => ({ ...c, file: `/vrm-lab/${c.file}` }));
        setClips(entries);
        const actClips = {};
        for (const entry of entries) {
          for (const act of entry.acts || []) {
            (actClips[act] ||= []).push(entry);
          }
        }
        const talkClips = entries.filter((entry) => entry.talk);
        stageRef.current?.setClipCatalog({ actClips, talkClips, autoClips: true });
        // Only the clips an act can trigger are warmed: the full catalogue is
        // ~4 MB and the rest can load on first click.
        stageRef.current?.preloadClips(entries.filter((entry) => entry.acts?.length));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Fish Audio status ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/tts/fish/status", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
      fetch("/tts/fish/voices", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([status, list]) => {
        if (cancelled) return;
        setFishConfigured(Boolean(status?.configured));
        setFishVoices(list?.voices || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // The selected idle clip is applied centrally so the persisted config and
  // the picker take the same path.
  useEffect(() => {
    if (!clips.length) return;
    const clip = clips.find((c) => c.id === idleClipId) || null;
    stageRef.current?.setIdleClip(clip);
  }, [clips, idleClipId]);

  // Idle variation runs in the stage's render loop; the pool is the looping
  // idle clips from the catalogue.
  useEffect(() => {
    const pool = clips.filter((clip) => clip.category === "idle");
    stageRef.current?.setIdleRotation(varyIdle, pool);
  }, [varyIdle, clips]);

  // ── Voices ────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/tts/piper/voices", { credentials: "same-origin" })
      .then(async (res) => {
        if (res.status === 401) throw new Error("401");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const list = data.voices || [];
        setVoices(list);
        const preferred =
          list.find((v) => v.id === "es_MX-alan-medium.onnx") ||
          list.find((v) => v.id.startsWith("es_MX")) ||
          list[0];
        if (preferred) setVoice(preferred.id);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err.message === "401"
            ? "Inicia sesión en VTAmigo en otra pestaña y recarga el laboratorio."
            : `No se pudo leer la lista de voces: ${err.message}`
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadFile = useCallback(async (file) => {
    if (!file) return;
    if (!/\.vrm$/i.test(file.name)) {
      setError("Suelta un archivo .vrm (VRM 0.x o VRM 1.0).");
      return;
    }
    setError("");
    setNotice("");
    setLoadingModel(true);
    try {
      await stageRef.current.loadModel(file, file.name);
    } catch (err) {
      setLoadingModel(false);
      setError(`No se pudo cargar el modelo: ${err.message || "archivo no válido"}`);
    }
  }, []);

  const loadUrl = useCallback(async () => {
    const url = modelUrl.trim();
    if (!url) return;
    setError("");
    setNotice("");
    setLoadingModel(true);
    try {
      await stageRef.current.loadModel(url, url.split("/").pop() || "modelo.vrm");
      saveConfig({ modelUrl: url });
    } catch (err) {
      setLoadingModel(false);
      setError(
        `No se pudo cargar el modelo: ${err.message}. Si es de otro dominio, necesita CORS.`
      );
    }
  }, [modelUrl, saveConfig]);

  const unload = useCallback(() => {
    stageRef.current?.unloadModel();
    setModel(null);
    setSpeech(null);
  }, []);

  const togglePreview = useCallback((name) => {
    setPreview((current) => {
      const next = current === name ? null : name;
      stageRef.current?.setPreview(next);
      return next;
    });
  }, []);

  const speak = useCallback(async () => {
    if (!stageRef.current || !text.trim()) return;
    setPreview(null);
    stageRef.current.setPreview(null);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const act = actOverride === "auto" ? actFor(text) : actOverride;
      setLastAct(act);
      const voiceId = provider === "fish" ? fishVoice.trim() : voice;
      const data = await stageRef.current.speak(text.trim(), voiceId || undefined, act, provider);
      setSpeech(data);
      if (data.warning === "PHONEMIZER_UNAVAILABLE") {
        setNotice("El fonemizador no está disponible: suena la voz, pero sin visemas.");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [text, voice, actOverride, provider, fishVoice]);

  const randomizeText = useCallback(() => {
    setText(randomLine());
    setError("");
    setNotice("");
  }, []);

  const playPreview = useCallback(() => {
    const clip = clips.find((c) => c.id === previewClipId);
    if (!clip || !stageRef.current) return;
    setError("");
    stageRef.current.playAnimation(clip).catch((err) => setError(err.message));
  }, [clips, previewClipId]);

  const playRandomClip = useCallback(() => {
    if (!stageRef.current || !clips.length) return;
    const pool = clips.filter((clip) => !clip.loop || clip.category !== "idle");
    const clip = pool[Math.floor(Math.random() * pool.length)];
    setPreviewClipId(clip.id);
    setError("");
    stageRef.current.playAnimation(clip).catch((err) => setError(err.message));
  }, [clips]);

  const changeIdle = useCallback((value) => {
    setIdleClipId(value);
    saveConfig({ idleClip: value });
  }, [saveConfig]);

  const toggleAutoClips = useCallback((value) => {
    setAutoClips(value);
    stageRef.current?.setAutoClips(value);
    saveConfig({ autoClips: value });
  }, [saveConfig]);

  const toggleVaryIdle = useCallback((value) => {
    setVaryIdle(value);
    saveConfig({ varyIdle: value });
  }, [saveConfig]);

  const copyOverlayUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setOverlayCopied(true);
      window.setTimeout(() => setOverlayCopied(false), 1500);
    } catch {
      /* clipboard unavailable: the input is selectable */
    }
  }, [overlayUrl]);

  const changeAct = useCallback((value) => {
    setActOverride(value);
    setLastAct(value === "auto" ? null : value);
    // Preview the pose immediately while silent; the next line re-applies it.
    stageRef.current?.setAct(value === "auto" ? "neutral" : value);
  }, []);

  const stop = useCallback(() => {
    stageRef.current?.stop();
  }, []);

  const activeViseme = useMemo(() => {
    let best = null;
    let bestValue = 0.18;
    for (const name of VISEME_NAMES) {
      if (weights[name] > bestValue) {
        best = name;
        bestValue = weights[name];
      }
    }
    return best;
  }, [weights]);

  const duration = frame.duration || speech?.duration || 0;
  const idleClips = clips.filter((clip) => clip.category === "idle");
  const activeClipLabel = clips.find((clip) => clip.id === activeClipId)?.label || "";

  return (
    <div className="vrmLab">
      <header className="vrmLabHeader">
        <div className="vrmLabTitle">
          <span className="vrmLabMark">
            <Waves size={18} />
          </span>
          <div>
            <h1>VRM Lip-Sync Lab</h1>
            <p>texto → fonemas (espeak-ng) → visemas → blendshapes del VRM</p>
          </div>
        </div>
        <div className="vrmLabBadges">
          <span className="vrmLabBadge">prototipo</span>
          <span className="vrmLabBadge vrmLabBadgeMuted">{model?.version || "sin modelo"}</span>
        </div>
      </header>

      <main className="vrmLabMain">
        <section
          className={`vrmStage ${dragging ? "isDragging" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            loadFile(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="vrmCanvas" ref={mountRef} />

          {!model && !loadingModel && (
            <div className="vrmEmpty">
              <Upload size={34} />
              <h2>Arrastra un .vrm aquí</h2>
              <p>o elige un archivo / pega una URL. El modelo no se sube: vive en tu navegador.</p>
              <button className="vrmBtn vrmBtnPrimary" onClick={() => fileRef.current?.click()}>
                <Upload size={15} /> Elegir archivo
              </button>
            </div>
          )}

          {loadingModel && (
            <div className="vrmEmpty">
              <Loader2 size={30} className="vrmSpin" />
              <h2>Cargando modelo…</h2>
              <div className="vrmProgress">
                <div style={{ width: `${Math.round(loadProgress * 100)}%` }} />
              </div>
            </div>
          )}

          {model && (
            <>
              <div className="vrmStageHud">
                <span className="vrmDot" data-on={frame.speaking} />
                <strong>{model.name}</strong>
                <span>{model.expressions?.length ? `${model.expressions.length} expresiones` : ""}</span>
                {frame.speaking && lastAct && <span className="vrmActBadge">{ACT_LABELS[lastAct]}</span>}
              </div>
              <div className="vrmTimeline">
                {duration > 0 && speech?.visemes?.length > 0 && (
                  <div className="vrmTimelineSegments">
                    {speech.visemes.map((seg, i) => (
                      <span
                        key={i}
                        className="vrmTimelineSeg"
                        style={{
                          left: `${(seg.t / duration) * 100}%`,
                          width: `${Math.max(0.35, (seg.d / duration) * 100)}%`,
                          background: VISEME_COLORS[seg.v] || "#555",
                          opacity: seg.v === "close" ? 0.9 : 0.4 + (seg.amp ?? 1) * 0.5,
                        }}
                        title={`${seg.v} · ${Math.round(seg.t * 1000)} ms`}
                      />
                    ))}
                  </div>
                )}
                <div className="vrmPlayhead" ref={playheadRef} />
              </div>
            </>
          )}

          {dragging && <div className="vrmDropVeil">Suelta el .vrm</div>}
        </section>

        <aside className="vrmPanel">
          <div className="vrmSection">
            <h3>Modelo</h3>
            <input
              ref={fileRef}
              type="file"
              accept=".vrm"
              hidden
              onChange={(e) => loadFile(e.target.files?.[0])}
            />
            <div className="vrmRow">
              <button className="vrmBtn" onClick={() => fileRef.current?.click()}>
                <Upload size={15} /> Archivo .vrm
              </button>
              <button className="vrmBtn vrmBtnGhost" onClick={unload} disabled={!model}>
                Quitar
              </button>
            </div>
            <div className="vrmRow">
              <input
                type="url"
                placeholder="https://…/modelo.vrm"
                value={modelUrl}
                onChange={(e) => setModelUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && loadUrl()}
              />
              <button className="vrmBtn" onClick={loadUrl} disabled={!modelUrl.trim()}>
                Cargar
              </button>
            </div>
          </div>

          <div className="vrmSection">
            <h3>
              Overlay para OBS <span className="vrmHint">{overlayUrl ? "listo" : "…"}</span>
            </h3>
            <div className="vrmRow">
              <input
                readOnly
                value={overlayUrl}
                placeholder="obteniendo token…"
                onFocus={(e) => e.target.select()}
              />
              <button className="vrmBtn" onClick={copyOverlayUrl} disabled={!overlayUrl}>
                {overlayCopied ? "Copiado" : "Copiar"}
              </button>
            </div>
            <div className="vrmRow">
              <a
                className="vrmBtn vrmBtnGhost"
                href={overlayUrl ? `${overlayUrl}&debug=1` : "#"}
                target="_blank"
                rel="noreferrer"
                style={{ flex: 1 }}
              >
                Abrir con debug
              </a>
            </div>
            <p className="vrmFootnote">
              Fondo transparente y audio propio. En la app pon la salida de voz en «Overlay» o
              «Ambos». El modelo se carga solo desde la URL guardada: cárgalo por URL (no por
              archivo) para que persista.
            </p>
          </div>

          <div className="vrmSection">
            <h3>Voz y texto</h3>
            <label className="vrmLabel">
              Proveedor
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="piper">Piper (local, offline)</option>
                <option value="fish">Fish Audio (API)</option>
              </select>
            </label>
            {provider === "piper" ? (
              <label className="vrmLabel">
                Voz Piper
                <select value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {voices.length === 0 && <option value="">Sin voces</option>}
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="vrmLabel">
                Voice model (reference_id)
                <input
                  type="text"
                  list="vrm-fish-voices"
                  placeholder="id de Fish o vacío para la voz por defecto"
                  value={fishVoice}
                  onChange={(e) => setFishVoice(e.target.value)}
                />
                <datalist id="vrm-fish-voices">
                  {fishVoices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </datalist>
                <span className={`vrmFishState ${fishConfigured ? "isOn" : ""}`}>
                  {fishConfigured === null
                    ? "comprobando Fish Audio…"
                    : fishConfigured
                      ? `Fish Audio listo · modelo gratuito s2.1-pro-free${fishVoices.length ? ` · ${fishVoices.length} voces` : ""}`
                      : "Fish Audio sin configurar: falta FISH_AUDIO_API_KEY en el servidor"}
                </span>
              </label>
            )}
            <label className="vrmLabel">
              Actitud <span className="vrmHint">idle + gesto según el texto</span>
              <select value={actOverride} onChange={(e) => changeAct(e.target.value)}>
                <option value="auto">automática (según el texto)</option>
                {Object.entries(ACT_LABELS).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <textarea
              value={text}
              maxLength={400}
              rows={5}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escribe lo que debe decir el avatar…"
            />
            <div className="vrmRow vrmRowEnd">
              <span className="vrmCounter">{text.length}/400</span>
              <button
                className="vrmBtn vrmBtnGhost"
                onClick={randomizeText}
                title="Generar un texto aleatorio"
              >
                <Dices size={15} />
              </button>
              <button className="vrmBtn vrmBtnPrimary" onClick={speak} disabled={busy || !text.trim()}>
                {busy ? <Loader2 size={15} className="vrmSpin" /> : <Play size={15} />}
                {busy ? "Sintetizando…" : "Hablar"}
              </button>
              <button className="vrmBtn vrmBtnGhost" onClick={stop}>
                <Square size={14} /> Parar
              </button>
            </div>
          </div>

          <div className="vrmSection">
            <h3>
              Animaciones VRMA{" "}
              <span className="vrmHint">
                {activeClipLabel ? `▶ ${activeClipLabel}` : `${clips.length} clips`}
              </span>
            </h3>
            <label className="vrmLabel">
              En reposo
              <select value={idleClipId} onChange={(e) => changeIdle(e.target.value)}>
                <option value="">procedural (respiración)</option>
                {idleClips.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="vrmRow">
              <select value={previewClipId} onChange={(e) => setPreviewClipId(e.target.value)}>
                <option value="">Probar un clip…</option>
                {Object.entries(CLIP_CATEGORIES).map(([category, label]) => {
                  const items = clips.filter((clip) => clip.category === category);
                  if (!items.length) return null;
                  return (
                    <optgroup key={category} label={label}>
                      {items.map((clip) => (
                        <option key={clip.id} value={clip.id}>
                          {clip.label}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              <button
                className="vrmBtn"
                onClick={playPreview}
                disabled={!previewClipId}
                title="Reproducir el clip elegido"
              >
                <Play size={14} />
              </button>
              <button
                className="vrmBtn vrmBtnGhost"
                onClick={() => stageRef.current?.stopAnimation()}
                title="Parar el clip"
              >
                <Square size={13} />
              </button>
              <button
                className="vrmBtn vrmBtnGhost"
                onClick={playRandomClip}
                title="Clip aleatorio"
              >
                <Dices size={15} />
              </button>
            </div>
            <label className="vrmCheck">
              <input
                type="checkbox"
                checked={varyIdle}
                onChange={(e) => toggleVaryIdle(e.target.checked)}
              />
              variar el idle cada ~30 s
            </label>
            <label className="vrmCheck">
              <input
                type="checkbox"
                checked={autoClips}
                onChange={(e) => toggleAutoClips(e.target.checked)}
              />
              usar clip en saludo, pensar, gracias, emoción y sorpresa
            </label>
          </div>

          <div className="vrmSection">
            <h3>
              Visemas en vivo{" "}
              <span className="vrmHint">{activeViseme ? VISEME_LABEL[activeViseme] : "silencio"}</span>
            </h3>
            <div className="vrmBars" ref={weightsRef}>
              {[...VISEME_NAMES, "close"].map((name) => (
                <div className="vrmBar" key={name}>
                  <div className="vrmBarTrack">
                    <div
                      className="vrmBarFill"
                      data-viseme={name}
                      style={{ background: VISEME_COLORS[name] }}
                    />
                  </div>
                  <span>{VISEME_LABEL[name]}</span>
                </div>
              ))}
            </div>
            <div className="vrmMeters">
              <span>
                <Volume2 size={13} /> <span ref={timeRef}>0.00 / 0.00 s</span>
              </span>
              {speech && (
                <>
                  <span>{speech.visemes?.length || 0} segmentos</span>
                  <span>{speech.phonemes?.length || 0} fonemas</span>
                  <span>{speech.provider === "fish" ? "fish" : "piper"}</span>
                  {lastAct && <span>actitud: {ACT_LABELS[lastAct]}</span>}
                </>
              )}
            </div>
            <div className="vrmPreview">
              <span className="vrmPreviewLabel">Probar</span>
              {VISEME_NAMES.map((name) => (
                <button
                  key={name}
                  className={`vrmChip ${preview === name ? "isOn" : ""}`}
                  onClick={() => togglePreview(name)}
                  title={`Forzar visema ${name}`}
                >
                  {VISEME_LABEL[name]}
                </button>
              ))}
            </div>
          </div>

          {(error || notice) && (
            <div className={`vrmNotice ${error ? "isError" : ""}`}>
              <AlertTriangle size={15} />
              <span>{error || notice}</span>
            </div>
          )}

          {speech?.phonemes?.length > 0 && (
            <div className="vrmSection">
              <h3>Fonemas</h3>
              <div className="vrmPhonemes">{speech.phonemes.join(" ")}</div>
            </div>
          )}

          <p className="vrmFootnote">
            Duraciones estimadas por clase fonética y escaladas al audio real. Clips VRMA de
            terceros (MIT) — ver{" "}
            <a href="/vrm-lab/CREDITS.md" target="_blank" rel="noreferrer">
              créditos
            </a>
            .
          </p>
        </aside>
      </main>
    </div>
  );
}
