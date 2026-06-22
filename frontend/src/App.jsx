import React, { useState, useEffect, useRef, useCallback } from "react";
import ChatFeed from "./ChatFeed.jsx";
import ResponsePanel from "./ResponsePanel.jsx";
import Settings from "./Settings.jsx";
import { tts } from "./TTSController.js";
import { voice } from "./VoiceTranscription.js";

const DEFAULT_BASE_PROMPT = `Eres un co-presentador de IA para un stream de Twitch de gaming y just-chatting.

Responde en 1–3 oraciones. Sé ingenioso, no cringe. Aporta algo — no solo repitas lo que dijo el chat. Iguala la energía: tranquilo cuando ellos están tranquilos, hypeado cuando están hypeados.`;

const DEFAULT_SETTINGS = {
  channel: "",
  token: "",
  clientId: "",
  tiktokUsername: "",
  batchWindow: 20,
  maxMessages: 20,
  style: "auto",
  basePrompt: DEFAULT_BASE_PROMPT,
  idleRedditStories: true,
  idleStoryThreshold: 7,
  subreddits: "HistoriasDeReddit, AskRedditEsp, confesiones, anecdotasgraciosas, es",
  voiceURI: "",
  ttsRate: 1,
  ttsVolume: 1,
  vtubeUrl: "ws://localhost:8001",
  vtubePlugin: "Twitch Chat Bot",
  vtubeMouthParam: "MouthOpen",
  vtubeSensitivity: 0.8,
  micEnabled: false,
  micDeviceId: "",
  micLang: "es-ES",
  micLabel: "Streamer",
};

const WS_URL = "ws://localhost:3001/chat";
const HYPE_KEYWORDS = ["pogchamp", "pog", "omegalul", "lul", "kekw", "lets go", "let's go", "clip it", "letsgo", "hype"];
const BURST_SILENCE_MS = 3000; // how long silence after burst triggers response

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatEventText(event) {
  switch (event.kind) {
    case "follow":   return "¡Nuevo follow!";
    case "sub":      return `¡Nueva suscripción${event.isGift ? " (regalo)" : ""}!`;
    case "resub":    return `¡Resub × ${event.months} ${event.months === 1 ? "mes" : "meses"}!${event.message ? ` "${event.message}"` : ""}`;
    case "giftsub":  return `¡${event.isAnonymous ? "Anónimo" : event.username} regaló ${event.count} ${event.count === 1 ? "sub" : "subs"}!`;
    case "raid":     return `¡Raid con ${event.viewers} ${event.viewers === 1 ? "espectador" : "espectadores"}!`;
    case "cheer":    return `¡${event.bits} bits!${event.message ? ` "${event.message}"` : ""}`;
    default:         return "Evento de Twitch";
  }
}

export default function App() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("settings") || "{}") };
      // Migrate old Live2D param name to correct VTS tracking param name
      if (saved.vtubeMouthParam === "ParamMouthOpenY") saved.vtubeMouthParam = "MouthOpen";
      return saved;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const [showSettings, setShowSettings] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connStatus, setConnStatus] = useState("disconnected");
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [tiktokStatus, setTiktokStatus] = useState("disconnected");
  const [messages, setMessages] = useState([]);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [muted, setMuted] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [vtubeStatus, setVtubeStatus] = useState({ connected: false, authenticated: false });
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState(null);
  const [micModelStatus, setMicModelStatus] = useState("idle");
  const [micSpeaking, setMicSpeaking] = useState(false);
  const [micLastText, setMicLastText] = useState("");

  const wsRef = useRef(null);
  const bufferRef = useRef([]);
  const batchTimerRef = useRef(null);
  const burstTimerRef = useRef(null);
  const idleCountRef = useRef(0);
  const idleThresholdRef = useRef(null); // set on first empty batch from settings
  const countdownIntervalRef = useRef(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // TTS state sync
  useEffect(() => {
    tts.onStateChange = () => setTtsPlaying(tts.playing);
  }, []);

  // Auto-connect on startup if channels are saved
  useEffect(() => {
    if (settingsRef.current.channel) handleConnect();
    if (settingsRef.current.tiktokUsername) handleTikTokConnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Voice transcription — wire up transcript handler and sync settings
  useEffect(() => {
    voice.onStateChange = () => {
      setMicActive(voice.running);
      setMicError(voice.error);
      setMicModelStatus(voice.modelStatus);
      setMicSpeaking(voice.speaking);
      setMicLastText(voice.lastText);
    };
    voice.onTranscript = (text) => {
      const label = settingsRef.current.micLabel || "Streamer";
      const msg = { username: label, text, isVoice: true };
      setMessages((prev) => [...prev.slice(-199), {
        ...msg,
        id: `voice-${Date.now()}`,
        timestamp: Date.now(),
        color: "#00d4ff",
      }]);
      bufferRef.current.push({ username: label, text });
    };
  }, []);

  // Apply mic settings whenever they change
  useEffect(() => {
    voice.setLang(settings.micLang);
  }, [settings.micLang]);

  useEffect(() => {
    voice.setDevice(settings.micDeviceId);
  }, [settings.micDeviceId]);

  useEffect(() => {
    if (settings.micEnabled) voice.start();
    else voice.stop();
  }, [settings.micEnabled]);

  // VTube Studio status polling
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/vtube/status");
        if (res.ok) setVtubeStatus(await res.json());
      } catch {}
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  // Push VTube config to backend whenever relevant settings change
  useEffect(() => {
    fetch("/vtube/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: settings.vtubeUrl,
        pluginName: settings.vtubePlugin,
        mouthParam: settings.vtubeMouthParam,
        sensitivity: settings.vtubeSensitivity,
      }),
    }).catch(() => {});
  }, [settings.vtubeUrl, settings.vtubePlugin, settings.vtubeMouthParam, settings.vtubeSensitivity]);

  // Apply TTS settings whenever they change
  useEffect(() => {
    tts.setVoice(settings.voiceURI);
    tts.setRate(settings.ttsRate);
    tts.setVolume(settings.ttsVolume);
  }, [settings.voiceURI, settings.ttsRate, settings.ttsVolume]);

  // ── Batch triggering ──────────────────────────────────────────────────────

  const triggerResponse = useCallback(async () => {
    clearInterval(countdownIntervalRef.current);
    setCountdown(null);

    const batch = bufferRef.current.splice(0, settingsRef.current.maxMessages);
    if (batch.length === 0) {
      if (settingsRef.current.idleRedditStories !== false) {
        const t = settingsRef.current.idleStoryThreshold || 7;
        if (idleThresholdRef.current === null) idleThresholdRef.current = t;
        idleCountRef.current += 1;
        if (idleCountRef.current >= idleThresholdRef.current) {
          idleCountRef.current = 0;
          idleThresholdRef.current = t;
          triggerRedditStory();
        }
      }
      startCountdown();
      return;
    }

    setLoading(true);
    fetch("/vtube/thinking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    }).catch(() => {});

    const stopThinking = () =>
      fetch("/vtube/thinking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      }).catch(() => {});

    try {
      const res = await fetch("/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: batch, style: settingsRef.current.style, basePrompt: settingsRef.current.basePrompt, provider: settingsRef.current.provider || "claude" }),
      });
      const data = await res.json();
      const text = data.response || data.error || "No response";
      const entry = {
        id: uid(),
        timestamp: Date.now(),
        text,
        error: !!data.error,
        messageCount: batch.length,
      };
      setResponses((prev) => [...prev.slice(-49), entry]);
      if (data.error) {
        // No TTS will play — stop thinking now
        stopThinking();
      } else {
        tts.enqueue(text);
        // Thinking stops when TTS fires onstart → /lipsync/start → startSpeaking()
      }
    } catch (err) {
      stopThinking();
      setResponses((prev) => [
        ...prev.slice(-49),
        { id: uid(), timestamp: Date.now(), text: `Network error: ${err.message}`, error: true },
      ]);
    } finally {
      setLoading(false);
      startCountdown();
    }
  }, []);

  const triggerRedditStory = useCallback(async () => {
    setLoading(true);
    try {
      const subreddits = (settingsRef.current.subreddits || "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const res = await fetch("/reddit-story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subreddits }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const { story } = data;
      const label = `📖 r/${story.subreddit} — ${story.title}`;

      // Show the story text in the response panel
      setResponses((prev) => [...prev.slice(-49), {
        id: uid(),
        timestamp: Date.now(),
        text: `${story.title}\n\n${story.text}`,
        error: false,
        eventLabel: label,
        isStory: true,
      }]);

      // Read the story aloud; when done, ask Claude for thoughts on the last paragraph
      const lastParagraph = story.text
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .at(-1) || story.text.slice(-300);

      tts.enqueue(`${story.title}. ${story.text}`, async () => {
        try {
          const thoughtsRes = await fetch("/reddit-thoughts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              paragraph: lastParagraph,
              title: story.title,
              subreddit: story.subreddit,
              basePrompt: settingsRef.current.basePrompt,
              provider: settingsRef.current.provider || "claude",
            }),
          });
          const thoughtsData = await thoughtsRes.json();
          const thoughtsText = thoughtsData.response || thoughtsData.error || "Sin respuesta";
          setResponses((prev) => [...prev.slice(-49), {
            id: uid(),
            timestamp: Date.now(),
            text: thoughtsText,
            error: !!thoughtsData.error,
            eventLabel: `💬 Pensamientos — ${story.title}`,
          }]);
          if (!thoughtsData.error) tts.enqueue(thoughtsText);
        } catch (err) {
          console.error("[reddit-thoughts]", err.message);
        }
      });
    } catch (err) {
      setResponses((prev) => [...prev.slice(-49), {
        id: uid(), timestamp: Date.now(), text: `Error: ${err.message}`, error: true,
      }]);
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerEventResponse = useCallback(async (event) => {
    setLoading(true);
    try {
      const res = await fetch("/event-response", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, basePrompt: settingsRef.current.basePrompt, provider: settingsRef.current.provider || "claude" }),
      });
      const data = await res.json();
      const text = data.response || data.error || "Sin respuesta";
      const entry = {
        id: uid(),
        timestamp: Date.now(),
        text,
        error: !!data.error,
        eventKind: event.kind,
        eventLabel: formatEventText(event),
      };
      setResponses((prev) => [...prev.slice(-49), entry]);
      if (!data.error) tts.enqueue(text);
    } catch (err) {
      setResponses((prev) => [
        ...prev.slice(-49),
        { id: uid(), timestamp: Date.now(), text: `Error de red: ${err.message}`, error: true },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  function startCountdown() {
    clearInterval(countdownIntervalRef.current);
    const windowSec = settingsRef.current.batchWindow;
    setCountdown(windowSec);

    clearTimeout(batchTimerRef.current);
    batchTimerRef.current = setTimeout(triggerResponse, windowSec * 1000);

    let remaining = windowSec;
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining > 0 ? remaining : 0);
    }, 1000);
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  const connectWS = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setConnStatus("disconnected");
    };

    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "chat") {
          const msg = data.msg;
          setMessages((prev) => [...prev.slice(-199), msg]);
          bufferRef.current.push({
            username: msg.username,
            text: msg.text,
            isRedeem: msg.isRedeem || false,
            rewardTitle: msg.rewardTitle || null,
          });

          // Burst detection: lots of hype → wait for silence then fire
          const isHype = HYPE_KEYWORDS.some((kw) => msg.text.toLowerCase().includes(kw));
          if (isHype) {
            clearTimeout(burstTimerRef.current);
            burstTimerRef.current = setTimeout(() => {
              if (bufferRef.current.length >= 5) triggerResponse();
            }, BURST_SILENCE_MS);
          }
        } else if (data.type === "status") {
          setConnStatus(data.status.type);
        } else if (data.type === "tiktok_status") {
          const t = data.status.type;
          setTiktokStatus(t);
          setTiktokConnected(t === "connected");
        } else if (data.type === "twitch_event") {
          const event = data.event;
          // Show event as a special entry in the chat feed
          setMessages((prev) => [...prev.slice(-199), {
            id: event.id,
            timestamp: event.timestamp,
            username: event.username || "Twitch",
            text: formatEventText(event),
            color: "#9147ff",
            isEvent: true,
            eventKind: event.kind,
          }]);
          // Immediately trigger a Claude response for this event
          triggerEventResponse(event);
        }
      } catch {
        // ignore parse errors
      }
    };
  }, [triggerResponse]);

  // ── Twitch connect / disconnect ───────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    const { channel, token } = settingsRef.current;
    if (!channel) {
      setShowSettings(true);
      return;
    }
    try {
      await fetch("/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, token, clientId: settingsRef.current.clientId }),
      });
      connectWS();
      startCountdown();
    } catch (err) {
      setConnStatus("error");
    }
  }, [connectWS]);

  const handleDisconnect = useCallback(async () => {
    clearTimeout(batchTimerRef.current);
    clearInterval(countdownIntervalRef.current);
    clearTimeout(burstTimerRef.current);
    setCountdown(null);
    if (wsRef.current) wsRef.current.close();
    try {
      await fetch("/disconnect", { method: "POST" });
    } catch {}
    setConnStatus("disconnected");
    setConnected(false);
  }, []);

  // ── TikTok connect / disconnect ───────────────────────────────────────────

  const handleTikTokConnect = useCallback(async () => {
    const { tiktokUsername } = settingsRef.current;
    if (!tiktokUsername) return;
    try {
      const username = tiktokUsername.replace(/^@/, "");
      await fetch("/connect-tiktok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      setTiktokStatus("connecting");
    } catch {
      setTiktokStatus("error");
    }
  }, []);

  const handleTikTokDisconnect = useCallback(async () => {
    try {
      await fetch("/disconnect-tiktok", { method: "POST" });
    } catch {}
    setTiktokStatus("disconnected");
    setTiktokConnected(false);
  }, []);

  // ── Settings save ─────────────────────────────────────────────────────────

  const saveSettings = (newSettings) => {
    const prev = settingsRef.current;
    setSettings(newSettings);
    localStorage.setItem("settings", JSON.stringify(newSettings));
    setShowSettings(false);
    // If window size changed and connected, restart countdown
    if (connected) {
      clearTimeout(batchTimerRef.current);
      clearInterval(countdownIntervalRef.current);
      startCountdown();
    }
    // Reconnect TikTok if username changed
    if (newSettings.tiktokUsername !== prev.tiktokUsername) {
      handleTikTokDisconnect().then(() => {
        if (newSettings.tiktokUsername) handleTikTokConnect();
      });
    }
  };

  // ── Mute toggle ───────────────────────────────────────────────────────────

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    tts.setMuted(next);
  };

  // ── Status badge ──────────────────────────────────────────────────────────

  const statusColor = {
    connected: "var(--green)",
    eventsub_connected: "var(--green)",
    connecting: "var(--yellow)",
    eventsub_connecting: "var(--yellow)",
    disconnected: "var(--text-muted)",
    eventsub_disconnected: "var(--text-muted)",
    error: "var(--red)",
    eventsub_error: "var(--red)",
    auth_error: "var(--red)",
  }[connStatus] || "var(--text-muted)";

  const statusLabel = {
    connected: `Conectado a #${settings.channel}`,
    eventsub_connected: `EventSub activo en #${settings.channel}`,
    connecting: "Conectando…",
    eventsub_connecting: "Conectando EventSub…",
    disconnected: "Desconectado",
    eventsub_disconnected: "EventSub desconectado",
    error: "Error de conexión",
    eventsub_error: "Error en EventSub",
    auth_error: "Error de auth — revisa el token OAuth",
  }[connStatus] || connStatus;

  return (
    <div style={styles.root}>
      {/* ── Top bar ── */}
      <div style={styles.topBar}>
        <div style={styles.brand}>
          <span style={styles.brandIcon}>🎮</span>
          <span style={styles.brandName}>AI Companion</span>
        </div>
        <div style={styles.topRight}>
          <button
            style={styles.settingsBtn}
            onClick={() => setShowSettings(true)}
          >
            ⚙ Settings
          </button>
          {connected ? (
            <button style={{ ...styles.btn, background: "var(--red)" }} onClick={handleDisconnect}>
              Disconnect
            </button>
          ) : (
            <button
              style={{ ...styles.btn, background: "var(--purple)" }}
              onClick={handleConnect}
            >
              Connect
            </button>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={styles.main}>
        {/* Left: chat feed */}
        <div style={styles.leftPanel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelTitle}>Live Chat</span>
            <span style={styles.msgCount}>{messages.length} messages</span>
          </div>
          <ChatFeed messages={messages} />
        </div>

        {/* Divider */}
        <div style={styles.divider} />

        {/* Right: response history */}
        <div style={styles.rightPanel}>
          <ResponsePanel responses={responses} loading={loading} />
        </div>
      </div>

      {/* ── Bottom bar ── */}
      <div style={styles.bottomBar}>
        {/* Twitch status */}
        <div style={styles.statusGroup}>
          <span style={{ ...styles.dot, background: statusColor }} />
          <span style={styles.statusText}>{statusLabel}</span>
        </div>

        {/* TikTok status */}
        {settings.tiktokUsername && (
          <div style={styles.statusGroup}>
            <span style={{
              ...styles.dot,
              background: tiktokConnected ? "var(--green)" : tiktokStatus === "connecting" ? "var(--yellow)" : "var(--text-muted)",
            }} />
            <span style={styles.statusText}>
              TikTok: {tiktokConnected ? `@${settings.tiktokUsername.replace(/^@/, "")}` : tiktokStatus === "connecting" ? "conectando…" : "desconectado"}
            </span>
            {tiktokConnected ? (
              <button
                style={{ ...styles.iconBtn, fontSize: 10, padding: "2px 6px" }}
                onClick={handleTikTokDisconnect}
                title="Disconnect TikTok"
              >
                ✕
              </button>
            ) : (
              <button
                style={{ ...styles.iconBtn, fontSize: 10, padding: "2px 6px" }}
                onClick={handleTikTokConnect}
                title="Connect TikTok"
              >
                ↻
              </button>
            )}
          </div>
        )}

        {/* VTube Studio status */}
        <div style={styles.statusGroup}>
          <span
            style={{
              ...styles.dot,
              background: vtubeStatus.authenticated
                ? "var(--green)"
                : vtubeStatus.connected
                ? "var(--yellow)"
                : "var(--text-muted)",
            }}
          />
          <span style={styles.statusText}>
            VTube:{" "}
            {vtubeStatus.authenticated
              ? "connected"
              : vtubeStatus.connected
              ? "authenticating…"
              : "disconnected"}
          </span>
          {!vtubeStatus.connected && (
            <button
              style={{ ...styles.iconBtn, fontSize: 10, padding: "2px 6px" }}
              onClick={() => fetch("/vtube/reconnect", { method: "POST" }).catch(() => {})}
              title="Retry VTube Studio connection"
            >
              ↻
            </button>
          )}
        </div>

        {/* Countdown */}
        {countdown !== null && (
          <div style={styles.countdownGroup}>
            <div style={styles.countdownBar}>
              <div
                style={{
                  ...styles.countdownFill,
                  width: `${(countdown / settings.batchWindow) * 100}%`,
                }}
              />
            </div>
            <span style={styles.countdownLabel}>next in {countdown}s</span>
          </div>
        )}

        {/* Buffer size */}
        {bufferRef.current.length > 0 && (
          <span style={styles.bufLabel}>{bufferRef.current.length} buffered</span>
        )}

        {/* Mic toggle + live preview */}
        {voice.supported && (
          <div style={styles.micGroup}>
            <button
              style={{
                ...styles.iconBtn,
                color: micError ? "var(--red)" : micActive ? "#00d4ff" : "var(--text-muted)",
                borderColor: micError ? "var(--red)" : micActive ? "#00d4ff" : "var(--border)",
                animation: micSpeaking ? "pulse 0.8s infinite" : "none",
                flexShrink: 0,
              }}
              onClick={() => {
                const next = !settings.micEnabled;
                const ns = { ...settings, micEnabled: next };
                setSettings(ns);
                localStorage.setItem("settings", JSON.stringify(ns));
              }}
              title={micError || (micActive ? "Mic activo — click para desactivar" : "Activar micrófono")}
            >
              {micError ? "🎙 Error" : micModelStatus === "loading" ? "🎙 Loading…" : micActive ? "🎙 Live" : "🎙 Mic"}
            </button>

            {/* Live status text */}
            {micActive && !micError && (
              <span style={{
                ...styles.micPreview,
                color: micSpeaking ? "var(--text)" : "var(--text-muted)",
                fontStyle: micSpeaking ? "normal" : "italic",
              }}>
                {micSpeaking
                  ? "● listening…"
                  : micLastText || "waiting for speech…"}
              </span>
            )}
            {micError && (
              <span style={{ ...styles.micPreview, color: "var(--red)" }}>{micError}</span>
            )}
            {!micError && !micActive && micModelStatus === "loading" && (
              <span style={{ ...styles.micPreview, color: "var(--yellow)" }}>downloading model…</span>
            )}
          </div>
        )}

        {/* TTS controls */}
        <div style={styles.ttsGroup}>
          {ttsPlaying && (
            <button
              style={{ ...styles.iconBtn, color: "var(--purple-light)" }}
              onClick={() => tts.skip()}
              title="Skip current TTS"
            >
              ⏭ Skip
            </button>
          )}
          <button
            style={{
              ...styles.iconBtn,
              color: muted ? "var(--red)" : "var(--text)",
            }}
            onClick={toggleMute}
            title={muted ? "Unmute TTS" : "Mute TTS"}
          >
            {muted ? "🔇 Muted" : "🔊 TTS"}
          </button>
          <button
            style={{ ...styles.iconBtn, color: "var(--text-muted)" }}
            onClick={() => triggerResponse()}
            disabled={loading}
            title="Forzar respuesta ahora"
          >
            ▶ Now
          </button>
          <button
            style={{ ...styles.iconBtn, color: "#ff9f43" }}
            onClick={() => triggerRedditStory()}
            disabled={loading}
            title="Contar una historia de Reddit"
          >
            📖 Historia
          </button>
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <Settings
          settings={settings}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    overflow: "hidden",
    background: "var(--bg)",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 16px",
    background: "var(--surface)",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  brand: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  brandIcon: { fontSize: 20 },
  brandName: {
    fontWeight: 800,
    fontSize: 16,
    color: "var(--purple-light)",
    letterSpacing: "-0.01em",
  },
  topRight: {
    display: "flex",
    gap: 8,
    alignItems: "center",
  },
  settingsBtn: {
    background: "var(--surface2)",
    color: "var(--text)",
    border: "1px solid var(--border)",
  },
  btn: {
    color: "#fff",
    minWidth: 90,
  },
  main: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
  leftPanel: {
    width: "40%",
    minWidth: 260,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid var(--border)",
    background: "var(--surface)",
    overflow: "hidden",
  },
  divider: {
    width: 0,
  },
  rightPanel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    background: "var(--surface)",
    overflow: "hidden",
  },
  panelHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 12px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  },
  panelTitle: {
    fontWeight: 700,
    fontSize: 13,
  },
  msgCount: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  bottomBar: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "8px 16px",
    background: "var(--surface)",
    borderTop: "1px solid var(--border)",
    flexShrink: 0,
    flexWrap: "wrap",
  },
  statusGroup: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    flexShrink: 0,
  },
  statusText: {
    fontSize: 12,
    color: "var(--text-muted)",
  },
  countdownGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: 1,
    maxWidth: 220,
  },
  countdownBar: {
    flex: 1,
    height: 4,
    background: "var(--border)",
    borderRadius: 2,
    overflow: "hidden",
  },
  countdownFill: {
    height: "100%",
    background: "var(--purple)",
    borderRadius: 2,
    transition: "width 1s linear",
  },
  countdownLabel: {
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  },
  bufLabel: {
    fontSize: 11,
    color: "var(--yellow)",
  },
  ttsGroup: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginLeft: "auto",
  },
  iconBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    fontSize: 12,
    padding: "5px 10px",
  },
  micGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    maxWidth: 280,
    overflow: "hidden",
  },
  micPreview: {
    fontSize: 11,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 200,
  },
};
