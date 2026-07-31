import React, { useState, useEffect, useRef, useCallback } from "react";
import ChatFeed from "./ChatFeed.jsx";
import ResponsePanel from "./ResponsePanel.jsx";
import Settings from "./Settings.jsx";
import Login from "./Login.jsx";
import Pending from "./Pending.jsx";
import { tts } from "./TTSController.js";
import { voice } from "./VoiceTranscription.js";
import { apiFetch, wsUrl } from "./api.js";
import { track } from "./analytics.js";
import { detectLanguage } from "./i18n/index.js";
import { tierLimits, clampToTier } from "./tiers.js";
import logo from "./img/logo.png";

const TIER_LABELS = { free: "Free", basic: "Basic", advanced: "Advanced", pro: "Pro" };

const DEFAULT_BASE_PROMPT = `Eres un co-presentador de IA para un stream de Twitch de gaming y just-chatting.

Responde en 1–3 oraciones. Sé ingenioso, no cringe. Aporta algo — no solo repitas lo que dijo el chat. Iguala la energía: tranquilo cuando ellos están tranquilos, hypeado cuando están hypeados.`;

const DEFAULT_SETTINGS = {
  language: detectLanguage(),
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
  ttsProvider: "windows",
  elevenLabsKey: "",
  elevenLabsVoiceId: "",
  piperVoice: "",
  vtubeUrl: "ws://localhost:8001",
  vtubePlugin: "Twitch Chat Bot",
  vtubeMouthParam: "MouthOpen",
  vtubeSensitivity: 0.8,
  micEnabled: false,
  micDeviceId: "",
  micLang: "es-ES",
  micLabel: "Streamer",
  botUsername: "",
  botToken: "",
  autoSendToChat: false,
  youtubePeekEnabled: false,
  youtubePeekInterval: 5,
  screenWatchEnabled: false,
  screenWatchInterval: 4,
  screenWatchWindow: 20,
  screenWatchRegion: "",
  screenWatchProcess: "",
  screenClickEnabled: false,
  screenClickTarget: "ai",
  screenAutoNavigate: false,
  ignoredUsers: "jonejo_ia, streamelements, nightbot, moobot, fossabot, streamlabs, soundalerts, wizebot, botisimo, coebot, sery_bot, kofistreambot, commanderroot, virgoproz, aparatchik, logviewer, electricallongboard, anotherttvviewer, twitchraidshadow",
};

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

// Gates the real app behind a Twitch-login + admin-approval check. AppInner
// (and its WS connection) only mounts once /auth/me reports an approved user.
export default function App() {
  const [authState, setAuthState] = useState(null); // null = loading

  const checkAuth = useCallback(() => {
    apiFetch("/auth/me")
      .then((r) => r.json())
      .then(setAuthState)
      .catch(() => setAuthState({ loggedIn: false }));
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  if (!authState) return null;
  if (!authState.loggedIn) return <Login />;
  if (!authState.approved) {
    return <Pending displayName={authState.displayName} onLoggedOut={checkAuth} />;
  }
  return <AppInner twitchLogin={authState.login} tier={authState.tier || "pro"} />;
}

function AppInner({ twitchLogin, tier }) {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("settings") || "{}") };
      // Migrate old Live2D param name to correct VTS tracking param name
      if (saved.vtubeMouthParam === "ParamMouthOpenY") saved.vtubeMouthParam = "MouthOpen";
      // Temporarily disabled features — grayed out in Settings, forced off here
      // regardless of any previously saved value.
      saved.idleRedditStories = false;
      saved.youtubePeekEnabled = false;
      saved.screenWatchEnabled = false;
      saved.provider = "claude";
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
  const [botStatus, setBotStatus] = useState("disconnected");
  const [micLastText, setMicLastText] = useState("");
  const [screenWatch, setScreenWatch] = useState({ state: "off", question: null, remaining: 0 });
  const [nowCooldownUntil, setNowCooldownUntil] = useState(0);
  const [nowSessionUsed, setNowSessionUsed] = useState(0);
  const [, forceNowTick] = useState(0);

  const wsRef = useRef(null);
  const seenMsgIds = useRef(new Set());
  const bufferRef = useRef([]);
  const batchTimerRef = useRef(null);
  const burstTimerRef = useRef(null);
  const idleCountRef = useRef(0);
  const idleThresholdRef = useRef(null); // set on first empty batch from settings
  const countdownIntervalRef = useRef(null);
  const youtubePeekTimerRef = useRef(null);
  const screenCollectRef = useRef(null); // { question, options, messages } while collecting chat
  const screenTimerRef = useRef(null);
  const screenCountdownRef = useRef(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const tierRef = useRef(tier);
  tierRef.current = tier;

  // TTS state sync
  useEffect(() => {
    tts.onStateChange = () => setTtsPlaying(tts.playing);
  }, []);

  // Auto-connect on mount — login always implies a channel now (the user's
  // own), so there's nothing to gate this on.
  useEffect(() => {
    handleConnect();
    if (settingsRef.current.tiktokUsername) handleTikTokConnect();
    return () => {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    };
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

  const handleSendTyped = useCallback((text) => {
    const label = twitchLogin || "Streamer";
    setMessages((prev) => [...prev.slice(-199), {
      id: `typed-${uid()}`,
      timestamp: Date.now(),
      username: label,
      text,
      isTyped: true,
    }]);
    bufferRef.current.push({ username: label, text });
  }, [twitchLogin]);

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
        const res = await apiFetch("/vtube/status");
        if (res.ok) setVtubeStatus(await res.json());
      } catch {}
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  // Push VTube config to backend whenever relevant settings change
  useEffect(() => {
    apiFetch("/vtube/config", {
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

  // Push XP ignore list to backend whenever it changes (also on startup)
  useEffect(() => {
    apiFetch("/xp/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ignoredUsers: settings.ignoredUsers || "" }),
    }).catch(() => {});
  }, [settings.ignoredUsers]);

  // Apply TTS settings whenever they change
  useEffect(() => {
    tts.setVoice(settings.voiceURI);
    tts.setRate(settings.ttsRate);
    tts.setVolume(settings.ttsVolume);
    tts.setProvider(settings.ttsProvider);
    tts.setElevenLabs({ apiKey: settings.elevenLabsKey, voiceId: settings.elevenLabsVoiceId });
    tts.setPiper({ voice: settings.piperVoice });
  }, [settings.voiceURI, settings.ttsRate, settings.ttsVolume, settings.ttsProvider, settings.elevenLabsKey, settings.elevenLabsVoiceId, settings.piperVoice]);

  // ── Batch triggering ──────────────────────────────────────────────────────

  const triggerResponse = useCallback(async (manual) => {
    clearInterval(countdownIntervalRef.current);
    setCountdown(null);

    const { maxMessages } = clampToTier(tierRef.current, settingsRef.current);
    const batch = bufferRef.current.splice(0, maxMessages);
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
    apiFetch("/vtube/thinking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    }).catch(() => {});

    const stopThinking = () =>
      apiFetch("/vtube/thinking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      }).catch(() => {});

    try {
      const res = await apiFetch("/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: batch, style: settingsRef.current.style, basePrompt: settingsRef.current.basePrompt, provider: settingsRef.current.provider || "claude", manual: !!manual }),
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
        stopThinking();
      } else {
        if (settingsRef.current.autoSendToChat && settingsRef.current.botUsername) {
          apiFetch("/say", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          }).then(async (r) => {
            if (!r.ok) {
              const d = await r.json().catch(() => ({}));
              console.warn("[bot/say]", d.error || r.status);
            }
          }).catch((e) => console.warn("[bot/say]", e.message));
        }
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
      const res = await apiFetch("/reddit-story", {
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
          const thoughtsRes = await apiFetch("/reddit-thoughts", {
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

  const triggerYouTubePeek = useCallback(async () => {
    try {
      const res = await apiFetch("/youtube-narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ basePrompt: settingsRef.current.basePrompt }),
      });
      const data = await res.json();
      const text = data.response || data.error || "Sin respuesta";
      setResponses((prev) => [...prev.slice(-49), {
        id: uid(),
        timestamp: Date.now(),
        text,
        error: !!data.error,
        eventLabel: "📺 YouTube Peek",
      }]);
      if (!data.error) tts.enqueue(text);
    } catch (err) {
      console.error("[youtube-peek]", err.message);
    }
  }, []);

  // YouTube peek timer — restart whenever enabled/interval changes
  useEffect(() => {
    clearInterval(youtubePeekTimerRef.current);
    if (!settings.youtubePeekEnabled) return;
    const ms = (settings.youtubePeekInterval || 5) * 60 * 1000;
    youtubePeekTimerRef.current = setInterval(triggerYouTubePeek, ms);
    return () => clearInterval(youtubePeekTimerRef.current);
  }, [settings.youtubePeekEnabled, settings.youtubePeekInterval, triggerYouTubePeek]);

  // ── Screen question watcher ───────────────────────────────────────────────

  // Push watcher config to backend whenever settings change (also on startup)
  useEffect(() => {
    apiFetch("/screenwatch/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: settings.screenWatchEnabled,
        intervalSec: settings.screenWatchInterval,
        region: settings.screenWatchRegion,
        processName: settings.screenWatchProcess,
        autoNavigate: settings.screenAutoNavigate,
      }),
    }).catch(() => {});
    if (!settings.screenWatchEnabled) {
      clearTimeout(screenTimerRef.current);
      clearInterval(screenCountdownRef.current);
      screenCollectRef.current = null;
      setScreenWatch({ state: "off", question: null, remaining: 0 });
    } else {
      setScreenWatch((s) => (s.state === "off" ? { state: "watching", question: null, remaining: 0 } : s));
    }
  }, [settings.screenWatchEnabled, settings.screenWatchInterval, settings.screenWatchRegion, settings.screenWatchProcess, settings.screenAutoNavigate]);

  const answerScreenQuestion = useCallback(async () => {
    clearInterval(screenCountdownRef.current);
    const collect = screenCollectRef.current;
    screenCollectRef.current = null;
    if (!collect) return;

    setScreenWatch({ state: "answering", question: collect.question, remaining: 0 });
    setLoading(true);
    let data = {};
    try {
      const res = await apiFetch("/screen-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: collect.question,
          options: collect.options,
          messages: collect.messages,
          basePrompt: settingsRef.current.basePrompt,
          provider: settingsRef.current.provider || "claude",
          windowSec: settingsRef.current.screenWatchWindow || 20,
        }),
      });
      data = await res.json();
      const text = data.response || data.error || "Sin respuesta";
      setResponses((prev) => [...prev.slice(-49), {
        id: uid(),
        timestamp: Date.now(),
        text,
        error: !!data.error,
        eventLabel: `🎯 Respuesta — ${collect.question.slice(0, 60)}`,
        messageCount: collect.messages.length || null,
      }]);
      if (!data.error) {
        tts.enqueue(text);
        if (settingsRef.current.autoSendToChat && settingsRef.current.botUsername) {
          apiFetch("/say", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          }).catch(() => {});
        }
      }

    } catch (err) {
      setResponses((prev) => [...prev.slice(-49), {
        id: uid(), timestamp: Date.now(), text: `Error de red: ${err.message}`, error: true,
      }]);
    } finally {
      // Auto-click the chosen option (AI's pick or chat's top vote), then
      // the backend clicks again after 3-5 s to advance to the next question.
      // Runs even when the AI errored, nobody picked anything, or the request
      // itself failed: fall back to the first option so the game never stays
      // stuck on the question.
      if (settingsRef.current.screenClickEnabled) {
        let idx = settingsRef.current.screenClickTarget === "chat"
          ? (data.topVoteIndex ?? data.choiceIndex)
          : (data.choiceIndex ?? data.topVoteIndex);
        if (idx == null || collect.options[idx] == null) idx = 0;
        if (collect.options[idx] != null) {
          apiFetch("/screenwatch/click", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              optionText: collect.options[idx],
              processName: settingsRef.current.screenWatchProcess,
              region: settingsRef.current.screenWatchRegion,
            }),
          }).then(async (r) => {
            if (!r.ok) {
              const d = await r.json().catch(() => ({}));
              setResponses((prev) => [...prev.slice(-49), {
                id: uid(), timestamp: Date.now(), text: `No pude hacer clic: ${d.error || r.status}`, error: true, eventLabel: "🖱️ Auto-click",
              }]);
            }
          }).catch(() => {});
        }
      }
      setLoading(false);
      setScreenWatch({
        state: settingsRef.current.screenWatchEnabled ? "watching" : "off",
        question: null,
        remaining: 0,
      });
    }
  }, []);

  const handleScreenQuestion = useCallback((question, options) => {
    if (screenCollectRef.current) return; // already collecting for another question
    const windowSec = settingsRef.current.screenWatchWindow || 20;
    screenCollectRef.current = { question, options, messages: [] };
    setScreenWatch({ state: "collecting", question, remaining: windowSec });

    // Show the detected question in the response panel right away
    const optionText = options
      .map((o, i) => `${String.fromCharCode(65 + i)} ) ${o}`)
      .join("\n");
    setResponses((prev) => [...prev.slice(-49), {
      id: uid(),
      timestamp: Date.now(),
      text: `${question}\n\n${optionText}\n\nEsperando al chat ${windowSec}s…`,
      error: false,
      eventLabel: "🖥️ Pregunta detectada en pantalla",
    }]);

    // Post the question to chat so viewers can vote (Twitch caps ~500 chars)
    if (settingsRef.current.autoSendToChat && settingsRef.current.botUsername) {
      const inline = options.map((o, i) => `${String.fromCharCode(65 + i)} ) ${o}`).join("  ");
      let chatMsg = `❓ ${question}  ${inline}  — ¡vota A/B/C/D! (${windowSec}s)`;
      if (chatMsg.length > 490) chatMsg = chatMsg.slice(0, 487) + "…";
      apiFetch("/say", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: chatMsg }),
      }).catch(() => {});
    }

    clearTimeout(screenTimerRef.current);
    screenTimerRef.current = setTimeout(answerScreenQuestion, windowSec * 1000);

    clearInterval(screenCountdownRef.current);
    let remaining = windowSec;
    screenCountdownRef.current = setInterval(() => {
      remaining -= 1;
      setScreenWatch((s) =>
        s.state === "collecting" ? { ...s, remaining: Math.max(remaining, 0) } : s
      );
    }, 1000);
  }, [answerScreenQuestion]);

  // Manual scan: read the screen right now and look for a question. If one is
  // found, the backend broadcasts screen_question and the normal flow starts.
  const triggerScreenScan = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/screenwatch/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region: settingsRef.current.screenWatchRegion,
          processName: settingsRef.current.screenWatchProcess,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (data.hasQuestion) {
        // Start the flow directly — no dependency on the WS broadcast
        // (handleScreenQuestion ignores duplicates if the broadcast also lands)
        handleScreenQuestion(data.question, data.options || []);
      } else {
        setResponses((prev) => [...prev.slice(-49), {
          id: uid(),
          timestamp: Date.now(),
          text: "No encontré ninguna pregunta con opciones en la pantalla.",
          error: false,
          eventLabel: "🖥️ Escaneo manual",
        }]);
      }
    } catch (err) {
      setResponses((prev) => [...prev.slice(-49), {
        id: uid(), timestamp: Date.now(), text: `Error: ${err.message}`, error: true, eventLabel: "🖥️ Escaneo manual",
      }]);
    } finally {
      setLoading(false);
    }
  }, [handleScreenQuestion]);

  const triggerEventResponse = useCallback(async (event) => {
    setLoading(true);
    try {
      const res = await apiFetch("/event-response", {
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
    const { batchWindow: windowSec } = clampToTier(tierRef.current, settingsRef.current);
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
    const ws = new WebSocket(wsUrl("/chat"));
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
          const ignoredUsers = (settingsRef.current.ignoredUsers || "")
            .split(",").map((u) => u.trim().toLowerCase()).filter(Boolean);
          if (ignoredUsers.includes((msg.username || "").toLowerCase())) return;
          if (seenMsgIds.current.has(msg.id)) return;
          seenMsgIds.current.add(msg.id);
          if (seenMsgIds.current.size > 500) {
            const first = seenMsgIds.current.values().next().value;
            seenMsgIds.current.delete(first);
          }
          setMessages((prev) => [...prev.slice(-199), msg]);
          bufferRef.current.push({
            username: msg.username,
            text: msg.text,
            isRedeem: msg.isRedeem || false,
            rewardTitle: msg.rewardTitle || null,
          });

          // While a screen question is open, also collect messages for it
          if (screenCollectRef.current) {
            screenCollectRef.current.messages.push({ username: msg.username, text: msg.text });
          }

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
        } else if (data.type === "bot_status") {
          setBotStatus(data.status.type);
        } else if (data.type === "tiktok_status") {
          const t = data.status.type;
          setTiktokStatus(t);
          setTiktokConnected(t === "connected");
        } else if (data.type === "screen_question") {
          handleScreenQuestion(data.question, data.options || []);
        } else if (data.type === "screenwatch_status") {
          if (data.status.type === "error") {
            setScreenWatch((s) =>
              s.state === "collecting" || s.state === "answering"
                ? s
                : { state: "error", question: null, remaining: 0, message: data.status.message }
            );
          } else if (data.status.type === "watching") {
            setScreenWatch((s) => (s.state === "error" ? { state: "watching", question: null, remaining: 0 } : s));
          }
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
  }, [triggerResponse, handleScreenQuestion]);

  // ── Twitch connect / disconnect ───────────────────────────────────────────

  const handleConnect = useCallback(async (manual) => {
    try {
      const res = await apiFetch("/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botUsername: settingsRef.current.botUsername,
          botToken: settingsRef.current.botToken,
          manual: !!manual,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setConnStatus("error");
        alert(d.error || `HTTP ${res.status}`);
        return;
      }
      connectWS();
      startCountdown();
    } catch (err) {
      setConnStatus("error");
    }
  }, [connectWS]);

  const handleDisconnect = useCallback(async (manual) => {
    clearTimeout(batchTimerRef.current);
    clearInterval(countdownIntervalRef.current);
    clearTimeout(burstTimerRef.current);
    setCountdown(null);
    if (wsRef.current) wsRef.current.close();
    try {
      await apiFetch("/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual: !!manual }),
      });
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
      await apiFetch("/connect-tiktok", {
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
      await apiFetch("/disconnect-tiktok", { method: "POST" });
    } catch {}
    setTiktokStatus("disconnected");
    setTiktokConnected(false);
  }, []);

  // ── Settings save ─────────────────────────────────────────────────────────

  const saveSettings = (newSettings) => {
    const prev = settingsRef.current;
    track("save_apply_click");
    if (newSettings.basePrompt !== prev.basePrompt) track("base_prompt_changed");
    if (newSettings.ttsProvider !== prev.ttsProvider) track("tts_provider_changed", { provider: newSettings.ttsProvider });
    if (newSettings.ttsRate !== prev.ttsRate) track("tts_speed_changed", { rate: newSettings.ttsRate });
    if (newSettings.ttsVolume !== prev.ttsVolume) track("tts_volume_changed", { volume: newSettings.ttsVolume });
    setSettings(newSettings);
    localStorage.setItem("settings", JSON.stringify(newSettings));
    setShowSettings(false);
    // If window size changed and connected, restart countdown
    if (connected) {
      clearTimeout(batchTimerRef.current);
      clearInterval(countdownIntervalRef.current);
      startCountdown();
    }
    // Reconnect only the bot client if credentials changed — avoids disrupting the main WS
    if (newSettings.botUsername && newSettings.botToken &&
      (newSettings.botUsername !== prev.botUsername || newSettings.botToken !== prev.botToken)
    ) {
      apiFetch("/connect-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          botUsername: newSettings.botUsername,
          botToken: newSettings.botToken,
        }),
      }).catch(() => {});
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

  // ── "Now" button — tier-gated cooldown / per-session usage limit ───────────

  useEffect(() => {
    if (!nowCooldownUntil) return;
    const id = setInterval(() => forceNowTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [nowCooldownUntil]);

  const nowLimits = tierLimits(tier);
  const nowOnCooldown = nowCooldownUntil > Date.now();
  const nowSessionExhausted = nowSessionUsed >= nowLimits.nowLimitPerSession;
  const nowRemainingSec = nowOnCooldown ? Math.ceil((nowCooldownUntil - Date.now()) / 1000) : 0;
  const nowDisabled = loading || nowOnCooldown || nowSessionExhausted;
  const nowTitle = nowSessionExhausted
    ? "Ya usaste el botón Now este sesión (límite de tu plan)"
    : nowOnCooldown
      ? `Disponible en ${Math.floor(nowRemainingSec / 60)}:${String(nowRemainingSec % 60).padStart(2, "0")}`
      : "Forzar respuesta ahora";

  const handleNowClick = () => {
    if (nowDisabled) return;
    setNowSessionUsed((c) => c + 1);
    if (nowLimits.nowCooldownMs > 0) setNowCooldownUntil(Date.now() + nowLimits.nowCooldownMs);
    triggerResponse(true);
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
    connected: `Conectado a #${twitchLogin}`,
    eventsub_connected: `EventSub activo en #${twitchLogin}`,
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
          <img src={logo} alt="VTAmigo" style={styles.brandIcon} />
          <span style={styles.brandName}>VTAmigo</span>
          {twitchLogin && (
            <span style={styles.brandUser}>— logged in as {twitchLogin} — {TIER_LABELS[tier] || tier}</span>
          )}
        </div>
        <div style={styles.topRight}>
          <button
            style={styles.settingsBtn}
            onClick={() => setShowSettings(true)}
          >
            ⚙ Settings
          </button>
          {connected ? (
            <button style={{ ...styles.btn, background: "var(--red)" }} onClick={() => handleDisconnect(true)}>
              Disconnect
            </button>
          ) : (
            <button
              style={{ ...styles.btn, background: "var(--purple)" }}
              onClick={() => handleConnect(true)}
            >
              Connect
            </button>
          )}
          <button
            style={styles.settingsBtn}
            onClick={() => apiFetch("/auth/logout", { method: "POST" }).finally(() => window.location.reload())}
          >
            Log out
          </button>
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
          <ChatFeed messages={messages} onSend={handleSendTyped} />
        </div>

        {/* Divider */}
        <div style={styles.divider} />

        {/* Right: response history */}
        <div style={styles.rightPanel}>
          <ResponsePanel
            responses={responses}
            loading={loading}
            botConnected={botStatus === "connected"}
            onSendToChat={(text) => apiFetch("/say", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text }),
            }).then(async (r) => {
              if (!r.ok) {
                const d = await r.json().catch(() => ({}));
                alert(`Bot error: ${d.error || r.status}`);
              }
            }).catch((e) => alert(`Bot error: ${e.message}`))}
          />
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

        {/* Bot status */}
        {settings.botUsername && (
          <div style={styles.statusGroup}>
            <span style={{
              ...styles.dot,
              background: botStatus === "connected" ? "var(--green)" : botStatus === "connecting" ? "var(--yellow)" : "var(--red)",
            }} />
            <span style={styles.statusText}>
              Bot: {botStatus === "connected" ? settings.botUsername : botStatus === "connecting" ? "conectando…" : "desconectado"}
            </span>
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
              onClick={() => apiFetch("/vtube/reconnect", { method: "POST" }).catch(() => {})}
              title="Retry VTube Studio connection"
            >
              ↻
            </button>
          )}
        </div>

        {/* Screen watch status */}
        {settings.screenWatchEnabled && (
          <div style={styles.statusGroup}>
            <span style={{
              ...styles.dot,
              background:
                screenWatch.state === "collecting" ? "var(--yellow)"
                : screenWatch.state === "answering" ? "var(--purple)"
                : screenWatch.state === "error" ? "var(--red)"
                : "var(--green)",
            }} />
            <span style={styles.statusText}>
              {screenWatch.state === "collecting"
                ? `🖥️ Pregunta — leyendo chat ${screenWatch.remaining}s`
                : screenWatch.state === "answering"
                ? "🖥️ Respondiendo pregunta…"
                : screenWatch.state === "error"
                ? `🖥️ ${screenWatch.message || "Error de captura"}`
                : "🖥️ Vigilando pantalla"}
            </span>
          </div>
        )}

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
            style={{ ...styles.iconBtn, color: "var(--text-muted)", opacity: nowDisabled && !loading ? 0.5 : 1 }}
            onClick={handleNowClick}
            disabled={nowDisabled}
            title={nowTitle}
          >
            ▶ Now{nowOnCooldown ? ` (${Math.floor(nowRemainingSec / 60)}:${String(nowRemainingSec % 60).padStart(2, "0")})` : ""}
          </button>
          <button
            style={{ ...styles.iconBtn, color: "#ff9f43" }}
            onClick={() => triggerRedditStory()}
            disabled={loading}
            title="Contar una historia de Reddit"
          >
            📖 Historia
          </button>
          <button
            style={{ ...styles.iconBtn, color: "#ff6b6b" }}
            onClick={() => triggerYouTubePeek()}
            disabled={loading}
            title="Narrar lo que hay en la pestaña de YouTube"
          >
            📺 YouTube
          </button>
          <button
            style={{ ...styles.iconBtn, color: "#4ecdc4" }}
            onClick={() => triggerScreenScan()}
            disabled={loading}
            title="Leer la pantalla ahora y buscar una pregunta con opciones"
          >
            🖥️ Pregunta
          </button>
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <Settings
          settings={settings}
          tier={tier}
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
  brandIcon: { width: 24, height: 24, objectFit: "contain" },
  brandUser: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontWeight: 400,
  },
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
