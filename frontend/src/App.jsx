import React, { useState, useEffect, useRef, useCallback } from "react";
import ChatFeed from "./ChatFeed.jsx";
import ResponsePanel from "./ResponsePanel.jsx";
import WindowManager, { DEFAULT_PANEL_LAYOUT, mergePanelLayout } from "./WindowManager.jsx";
import PanelsMenu from "./PanelsMenu.jsx";
import Settings from "./Settings.jsx";
import OnboardingTour from "./OnboardingTour.jsx";
import Login from "./Login.jsx";
import Pending from "./Pending.jsx";
import { tts } from "./TTSController.js";
import { voice, isChromeBrowser } from "./VoiceTranscription.js";
import { apiFetch, wsUrl } from "./api.js";
import { track } from "./analytics.js";
import { logError } from "./errorLogger.js";
import { detectLanguage, useTranslation } from "./i18n/index.js";
import { tierLimits, clampToTier } from "./tiers.js";
import logo from "./img/logo.png";

const TIER_LABELS = { free: "Free", basic: "Basic", advanced: "Advanced", pro: "Pro" };

const DEFAULT_SETTINGS = {
  language: detectLanguage(),
  panelLayout: DEFAULT_PANEL_LAYOUT,
  tiktokUsername: "",
  batchWindow: 20,
  maxMessages: 20,
  style: "auto",
  basePrompt: "",
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
  aiResponsesEnabled: true,
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

function formatEventText(event, t) {
  const messageSuffix = event.message ? t("app.events.messageSuffix", { message: event.message }) : "";
  switch (event.kind) {
    case "follow":   return t("app.events.follow");
    case "sub":      return event.isGift ? t("app.events.subGift") : t("app.events.sub");
    case "resub":    return t(event.months === 1 ? "app.events.resubOne" : "app.events.resubMany", { months: event.months, messageSuffix });
    case "giftsub": {
      const who = event.isAnonymous ? t("app.events.anonymous") : event.username;
      return t(event.count === 1 ? "app.events.giftSubOne" : "app.events.giftSubMany", { who, count: event.count });
    }
    case "raid":     return t(event.viewers === 1 ? "app.events.raidOne" : "app.events.raidMany", { viewers: event.viewers });
    case "cheer":    return t("app.events.cheer", { bits: event.bits, messageSuffix });
    default:         return t("app.events.default");
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

  // TEMPORARY: settings still live only in this browser's localStorage
  // (Settings.jsx), now that the server has moved to SQLite we push a copy
  // up on every approved login so it also exists server-side. One-way,
  // client -> server, and only fired once per login. Remove this whole
  // effect (and the POST /settings route) once settings are actually
  // persisted server-side as the source of truth instead of localStorage.
  const settingsSyncedRef = useRef(false);
  useEffect(() => {
    if (!authState?.loggedIn || !authState?.approved || settingsSyncedRef.current) return;
    settingsSyncedRef.current = true;
    try {
      const localSettings = JSON.parse(localStorage.getItem("settings") || "{}");
      apiFetch("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(localSettings),
      }).catch(() => {}); // best-effort; losing this sync isn't user-visible
    } catch {
      // malformed localStorage settings — nothing to sync
    }
  }, [authState]);

  if (!authState) return null;
  if (!authState.loggedIn) return <Login />;
  if (!authState.approved) {
    return <Pending displayName={authState.displayName} onLoggedOut={checkAuth} />;
  }
  return <AppInner twitchLogin={authState.login} tier={authState.tier || "pro"} onRefreshAuth={checkAuth} />;
}

function AppInner({ twitchLogin, tier, onRefreshAuth }) {
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
      saved.panelLayout = mergePanelLayout(saved.panelLayout);
      return saved;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });
  const { t } = useTranslation(settings.language);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("theme") || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // localStorage unavailable — theme choice won't persist.
    }
  }, [theme]);
  const cycleTheme = () => {
    setTheme((cur) => (cur === "system" ? "light" : cur === "light" ? "dark" : "system"));
  };
  // Debounced persistence for window drag/resize/collapse — react-rnd's
  // onDragStop/onResizeStop already fire once per gesture, so this is a
  // safety net rather than load-bearing, kept for consistency with the
  // debounce pattern used elsewhere (e.g. ChatOverlayPanel's set()).
  const layoutSaveTimerRef = useRef(null);
  const updateWindowLayout = useCallback((id, patch) => {
    setSettings((prev) => {
      const next = {
        ...prev,
        panelLayout: {
          windows: {
            ...prev.panelLayout.windows,
            [id]: { ...prev.panelLayout.windows[id], ...patch },
          },
        },
      };
      clearTimeout(layoutSaveTimerRef.current);
      layoutSaveTimerRef.current = setTimeout(() => {
        localStorage.setItem("settings", JSON.stringify(next));
      }, 300);
      return next;
    });
  }, []);

  // Bring-to-front without an ever-growing z counter: assign the clicked
  // window one past the current max, then if any z exceeds the window
  // count, re-rank all windows 1..N by relative order — keeps window
  // z-values permanently in a small band, safely below the Settings modal
  // (z=100) and onboarding tour (z=1000).
  const bringToFront = useCallback((id) => {
    setSettings((prev) => {
      const windows = prev.panelLayout.windows;
      const ids = Object.keys(windows);
      const maxZ = Math.max(...ids.map((k) => windows[k].z || 0));
      let nextWindows = { ...windows, [id]: { ...windows[id], z: maxZ + 1 } };
      if (maxZ + 1 > ids.length) {
        const ranked = [...ids].sort((a, b) => nextWindows[a].z - nextWindows[b].z);
        nextWindows = { ...nextWindows };
        ranked.forEach((k, i) => { nextWindows[k] = { ...nextWindows[k], z: i + 1 }; });
      }
      const next = { ...prev, panelLayout: { windows: nextWindows } };
      localStorage.setItem("settings", JSON.stringify(next));
      return next;
    });
  }, []);

  const [showSettings, setShowSettings] = useState(false);
  const [tourActive, setTourActive] = useState(() => {
    try {
      return localStorage.getItem("onboarding_done_v1") !== "1";
    } catch {
      return false;
    }
  });
  const [tourStep, setTourStep] = useState(0);
  const [tourPromptAttempts, setTourPromptAttempts] = useState(0);

  const finishTour = () => {
    setTourActive(false);
    try {
      localStorage.setItem("onboarding_done_v1", "1");
    } catch {
      // localStorage unavailable — tour will just replay next launch.
    }
  };

  const tourAdvance = (skip) => {
    setTourStep((s) => {
      if (s === 5) { // AI prompt step insists up to 3 times before allowing Next
        if (!skip && tourPromptAttempts < 2) {
          setTourPromptAttempts((a) => a + 1);
          return s;
        }
        setTourPromptAttempts(0);
        return 6;
      }
      return s + 1;
    });
  };
  const [connected, setConnected] = useState(false);
  const [connStatus, setConnStatus] = useState("disconnected");
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [tiktokStatus, setTiktokStatus] = useState("disconnected");
  const [messages, setMessages] = useState([]);
  const [responses, setResponses] = useState([]);
  const [activityEvents, setActivityEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [muted, setMuted] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [ttsSpeaking, setTtsSpeaking] = useState(false); // true only once audio is actually audible, unlike ttsPlaying (true from the start of generation)
  const [countdown, setCountdown] = useState(null);
  const [vtubeStatus, setVtubeStatus] = useState({ connected: false, authenticated: false });
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState(null);
  const [micModelStatus, setMicModelStatus] = useState("idle");
  const [micSpeaking, setMicSpeaking] = useState(false);
  const [videoState, setVideoState] = useState({ queue: [], defaultPlaylistId: null, nowPlaying: null });
  const [botStatus, setBotStatus] = useState("disconnected");
  const [activeBotUsername, setActiveBotUsername] = useState(null);
  const [usingSiteBot, setUsingSiteBot] = useState(false);
  const [micLastText, setMicLastText] = useState("");
  const [screenWatch, setScreenWatch] = useState({ state: "off", question: null, remaining: 0 });
  const [nowCooldownUntil, setNowCooldownUntil] = useState(0);
  const [nowSessionUsed, setNowSessionUsed] = useState(0);
  const [, forceNowTick] = useState(0);

  const wsRef = useRef(null);
  const seenMsgIds = useRef(new Set());
  const bufferRef = useRef([]);
  const [queuedCount, setQueuedCount] = useState(0);
  // Safety cap for when AI responses are toggled off for a long stretch —
  // messages keep queuing (nothing should be silently lost), but without a
  // ceiling a long-idle stream could grow this unbounded. Oldest entries
  // drop first once the cap is hit; the Prune button in Quick Controls lets
  // the streamer clear it manually at any time.
  const MAX_QUEUED_MESSAGES = 300;
  const pushToBuffer = useCallback((entry) => {
    bufferRef.current.push(entry);
    if (bufferRef.current.length > MAX_QUEUED_MESSAGES) {
      bufferRef.current.splice(0, bufferRef.current.length - MAX_QUEUED_MESSAGES);
    }
    setQueuedCount(bufferRef.current.length);
  }, []);
  const pruneQueue = useCallback(() => {
    bufferRef.current = [];
    setQueuedCount(0);
  }, []);
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
  const onRefreshAuthRef = useRef(onRefreshAuth);
  onRefreshAuthRef.current = onRefreshAuth;

  // TTS state sync
  useEffect(() => {
    tts.onStateChange = () => {
      setTtsPlaying(tts.playing);
      setTtsSpeaking(tts.speaking);
    };
  }, []);

  // Video queue — fetch current state on mount, since WS only pushes on the
  // *next* change; without this, a page refresh always looked empty even
  // though the backend still had a queue/nowPlaying.
  useEffect(() => {
    apiFetch("/video/state")
      .then((res) => res.json())
      .then((data) => setVideoState(data))
      .catch(() => {});
  }, []);

  // Activity Panel — same fetch-on-mount reasoning as video state above:
  // the WS only pushes new events as they happen, so without this a page
  // refresh always showed "no activity yet" even with real recent history.
  useEffect(() => {
    apiFetch("/activity/recent")
      .then((res) => res.json())
      .then((data) => setActivityEvents(data.events || []))
      .catch(() => {});
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
      pushToBuffer({ username: label, text });
    };
  }, [pushToBuffer]);

  const handleSendTyped = useCallback((text) => {
    const label = twitchLogin || "Streamer";
    setMessages((prev) => [...prev.slice(-199), {
      id: `typed-${uid()}`,
      timestamp: Date.now(),
      username: label,
      text,
      isTyped: true,
    }]);
    pushToBuffer({ username: label, text });
  }, [twitchLogin, pushToBuffer]);

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
    // AI responses toggled off in Quick Controls: the batch timer/countdown
    // is paused entirely (see the effect below), not just skipped here, so
    // this only fires from a stray race — bail without touching the buffer
    // so nothing queued gets lost. Resuming the toggle restarts the timer.
    if (settingsRef.current.aiResponsesEnabled === false) return;

    clearInterval(countdownIntervalRef.current);
    setCountdown(null);

    const { maxMessages } = clampToTier(tierRef.current, settingsRef.current);
    const batch = bufferRef.current.splice(0, maxMessages);
    setQueuedCount(bufferRef.current.length);

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
      if (data.tier) onRefreshAuthRef.current?.();
      const text = data.response || data.error || t("app.noResponse");
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
        if (settingsRef.current.autoSendToChat) {
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
          const thoughtsText = thoughtsData.response || thoughtsData.error || t("app.noResponse");
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
          logError("reddit-thoughts", err);
        }
      });
    } catch (err) {
      logError("reddit-story", err);
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
      const text = data.response || data.error || t("app.noResponse");
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
      logError("youtube-peek", err);
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
      const text = data.response || data.error || t("app.noResponse");
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
        if (settingsRef.current.autoSendToChat) {
          apiFetch("/say", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          }).catch(() => {});
        }
      }

    } catch (err) {
      setResponses((prev) => [...prev.slice(-49), {
        id: uid(), timestamp: Date.now(), text: t("app.networkError", { error: err.message }), error: true,
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
    if (settingsRef.current.autoSendToChat) {
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
      const text = data.response || data.error || t("app.noResponse");
      const entry = {
        id: uid(),
        timestamp: Date.now(),
        text,
        error: !!data.error,
        eventKind: event.kind,
        eventLabel: formatEventText(event, t),
      };
      setResponses((prev) => [...prev.slice(-49), entry]);
      if (!data.error) tts.enqueue(text);
    } catch (err) {
      setResponses((prev) => [
        ...prev.slice(-49),
        { id: uid(), timestamp: Date.now(), text: t("app.networkError", { error: err.message }), error: true },
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

  // Pause the batch timer/countdown entirely while AI responses are toggled
  // off — rather than letting it keep firing and dropping batches, which
  // would lose queued messages. Resuming the toggle restarts it (only if
  // already connected; otherwise there's nothing to resume yet).
  useEffect(() => {
    if (settings.aiResponsesEnabled === false) {
      clearTimeout(batchTimerRef.current);
      clearInterval(countdownIntervalRef.current);
      setCountdown(null);
    } else if (connected) {
      startCountdown();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.aiResponsesEnabled]);

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
          pushToBuffer({
            username: msg.username,
            text: msg.text,
            isRedeem: msg.isRedeem || false,
            rewardTitle: msg.rewardTitle || null,
          });
          if (msg.isRedeem) {
            setActivityEvents((prev) => [...prev.slice(-99), {
              id: msg.id,
              timestamp: msg.timestamp || Date.now(),
              kind: "redeem",
              username: msg.username,
              rewardTitle: msg.rewardTitle,
              text: msg.text,
            }]);
          }

          // While a screen question is open, also collect messages for it
          if (screenCollectRef.current) {
            screenCollectRef.current.messages.push({ username: msg.username, text: msg.text });
          }

          // Burst detection: lots of hype → wait for silence then fire
          const isHype = HYPE_KEYWORDS.some((kw) => msg.text.toLowerCase().includes(kw));
          if (isHype) {
            clearTimeout(burstTimerRef.current);
            burstTimerRef.current = setTimeout(() => {
              if (bufferRef.current.length >= 5 && settingsRef.current.aiResponsesEnabled !== false) triggerResponse();
            }, BURST_SILENCE_MS);
          }
        } else if (data.type === "status") {
          setConnStatus(data.status.type);
        } else if (data.type === "video_state") {
          const { type, ...state } = data;
          setVideoState(state);
        } else if (data.type === "bot_status") {
          setBotStatus(data.status.type);
          if (data.botUsername) setActiveBotUsername(data.botUsername);
          setUsingSiteBot(!!data.usingSiteBot);
        } else if (data.type === "tiktok_status") {
          const tiktokStatusType = data.status.type;
          setTiktokStatus(tiktokStatusType);
          setTiktokConnected(tiktokStatusType === "connected");
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
            text: formatEventText(event, t),
            color: "#9147ff",
            isEvent: true,
            eventKind: event.kind,
          }]);
          setActivityEvents((prev) => [...prev.slice(-99), event]);
          // Immediately trigger a Claude response for this event
          triggerEventResponse(event);
        }
      } catch {
        // ignore parse errors
      }
    };
  }, [triggerResponse, handleScreenQuestion, pushToBuffer]);

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

  const toggleAutoSend = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, autoSendToChat: !prev.autoSendToChat };
      localStorage.setItem("settings", JSON.stringify(next));
      return next;
    });
  }, []);

  const updateSetting = useCallback((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      localStorage.setItem("settings", JSON.stringify(next));
      return next;
    });
  }, []);

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
    if (tourActive && tourStep === 6) setTourStep(7);
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
  const nowDisabled = loading || nowOnCooldown || nowSessionExhausted || !settings.aiResponsesEnabled;
  const nowTitle = !settings.aiResponsesEnabled
    ? t("app.nowAiResponsesDisabled")
    : nowSessionExhausted
    ? t("app.nowSessionExhausted")
    : nowOnCooldown
      ? t("app.nowAvailableIn", { time: `${Math.floor(nowRemainingSec / 60)}:${String(nowRemainingSec % 60).padStart(2, "0")}` })
      : t("app.nowForceResponse");

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
    connected: t("app.status.connected", { channel: twitchLogin }),
    eventsub_connected: t("app.status.eventsubConnected", { channel: twitchLogin }),
    connecting: t("app.status.connecting"),
    eventsub_connecting: t("app.status.eventsubConnecting"),
    disconnected: t("app.status.disconnected"),
    eventsub_disconnected: t("app.status.eventsubDisconnected"),
    error: t("app.status.error"),
    eventsub_error: t("app.status.eventsubError"),
    auth_error: t("app.status.authError"),
  }[connStatus] || connStatus;

  return (
    <div style={styles.root}>
      {/* ── Top bar ── */}
      <div style={styles.topBar}>
        <div style={styles.brand}>
          <img src={logo} alt="VTAmigo" style={styles.brandIcon} />
          <span style={styles.brandName}>VTAmigo</span>
          {twitchLogin && (
            <span style={styles.brandUser}>{t("app.loggedInAs", { login: twitchLogin, tier: TIER_LABELS[tier] || tier })}</span>
          )}
        </div>
        <div style={styles.topRight}>
          <PanelsMenu panelLayout={settings.panelLayout} onUpdateWindow={updateWindowLayout} t={t} />
          <button
            style={styles.settingsBtn}
            onClick={() => window.open("/overlay-builder", "_blank")}
            title={t("app.overlayStudioTitle")}
          >
            {t("app.overlayStudioBtn")}
          </button>
          <button
            style={styles.settingsBtn}
            onClick={cycleTheme}
            title={t("app.themeTitle", { theme: t(`app.theme${theme[0].toUpperCase()}${theme.slice(1)}`) })}
          >
            {theme === "light" ? "☀️" : theme === "dark" ? "🌙" : "🖥️"}
          </button>
          <button
            style={styles.settingsBtn}
            data-tour="settings-btn"
            onClick={() => {
              setShowSettings(true);
              if (tourActive && tourStep === 3) setTourStep(4);
            }}
          >
            {t("app.settingsBtn")}
          </button>
          {connected ? (
            <button style={{ ...styles.btn, background: "var(--red)" }} onClick={() => handleDisconnect(true)}>
              {t("app.disconnect")}
            </button>
          ) : (
            <button
              style={{ ...styles.btn, background: "var(--purple)" }}
              onClick={() => handleConnect(true)}
            >
              {t("app.connect")}
            </button>
          )}
          <button
            style={styles.settingsBtn}
            onClick={() => apiFetch("/auth/logout", { method: "POST" }).finally(() => window.location.reload())}
          >
            {t("app.logout")}
          </button>
        </div>
      </div>

      {/* ── Main content: movable/resizable windows ── */}
      <WindowManager
        t={t}
        lang={settings.language}
        panelLayout={settings.panelLayout}
        onUpdateWindow={updateWindowLayout}
        onFocusWindow={bringToFront}
        chatFeedProps={{
          messages,
          onSend: handleSendTyped,
          micSupported: voice.supported,
          micChromeAllowed: voice.supported && isChromeBrowser(),
          micActive,
          micError,
          micModelStatus,
          micSpeaking,
          micLastText,
          lang: settings.language,
          onToggleMic: () => {
            const next = !settings.micEnabled;
            const ns = { ...settings, micEnabled: next };
            setSettings(ns);
            localStorage.setItem("settings", JSON.stringify(ns));
          },
        }}
        responsePanelProps={{
          responses,
          loading,
          botConnected: botStatus === "connected",
          lang: settings.language,
          onSendToChat: (text) => apiFetch("/say", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          }).then(async (r) => {
            if (!r.ok) {
              const d = await r.json().catch(() => ({}));
              alert(t("app.botError", { error: d.error || r.status }));
            }
          }).catch((e) => alert(t("app.botError", { error: e.message }))),
        }}
        quickControlsProps={{
          autoSendToChat: settings.autoSendToChat,
          onToggleAutoSend: toggleAutoSend,
          muted,
          onToggleMute: toggleMute,
          ttsPlaying,
          onSkipTts: () => tts.skip(),
          nowDisabled,
          nowOnCooldown,
          nowRemainingSec,
          nowTitle,
          onNowClick: handleNowClick,
          settings,
          onUpdateSetting: updateSetting,
          lang: settings.language,
          queuedCount,
          onPruneQueue: pruneQueue,
        }}
        avatarPanelProps={{ ttsSpeaking }}
        videoQueueProps={{ videoState }}
        activityPanelProps={{ events: activityEvents, lang: settings.language }}
      />

      {/* ── Bottom bar ── */}
      <div style={styles.bottomBar} data-tour="status-footer">
        {/* Twitch status */}
        <div style={styles.statusGroup}>
          <span style={{ ...styles.dot, background: statusColor }} />
          <span style={styles.statusText}>{statusLabel}</span>
        </div>

        {/* Now playing (video queue) */}
        {videoState.nowPlaying && (
          <div style={styles.statusGroup} title={videoState.nowPlaying.title}>
            <span style={styles.statusText}>
              {videoState.nowPlaying.paused ? "⏸" : "🎵"} {videoState.nowPlaying.title}
            </span>
          </div>
        )}

        {/* Bot status */}
        {(settings.botUsername || activeBotUsername) && (
          <div style={styles.statusGroup}>
            <span style={{
              ...styles.dot,
              background: botStatus === "connected" ? "var(--green)" : botStatus === "connecting" ? "var(--yellow)" : "var(--red)",
            }} />
            <span style={styles.statusText}>
              {t("app.botLine", {
                status: botStatus === "connected"
                  ? `${activeBotUsername || settings.botUsername}${usingSiteBot ? t("app.botSiteSuffix") : ""}`
                  : botStatus === "connecting" ? t("app.botConnecting") : t("app.botDisconnected"),
              })}
            </span>
          </div>
        )}

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
                ? t("app.screenWatch.collecting", { seconds: screenWatch.remaining })
                : screenWatch.state === "answering"
                ? t("app.screenWatch.answering")
                : screenWatch.state === "error"
                ? t("app.screenWatch.error", { message: screenWatch.message || t("app.screenWatch.errorDefault") })
                : t("app.screenWatch.watching")}
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
            <span style={styles.countdownLabel}>{t("app.countdown", { seconds: countdown })}</span>
          </div>
        )}

        {/* Buffer size */}
        {queuedCount > 0 && (
          <span style={styles.bufLabel}>{t("app.buffered", { count: queuedCount })}</span>
        )}

        {/* TTS volume */}
        <div style={styles.volumeGroup}>
          <span style={styles.statusText}>{muted ? "🔇" : "🔊"}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.ttsVolume}
            onChange={(e) => updateSetting("ttsVolume", Number(e.target.value))}
            disabled={muted}
            style={styles.volumeSlider}
            title={t("app.ttsVolumeTitle", { pct: Math.round(settings.ttsVolume * 100) })}
          />
          <span style={styles.countdownLabel}>{Math.round(settings.ttsVolume * 100)}%</span>
        </div>

      </div>

      {/* Settings modal */}
      {showSettings && (
        <Settings
          settings={settings}
          tier={tier}
          onSave={saveSettings}
          onClose={() => {
            setShowSettings(false);
            // Closed without saving mid-tour — bounce back to the "open settings"
            // step so the guided steps inside Settings stay reachable.
            if (tourActive && tourStep >= 4 && tourStep <= 6) setTourStep(3);
          }}
        />
      )}

      {tourActive && (
        <OnboardingTour
          lang={settings.language}
          step={tourStep}
          attempts={tourPromptAttempts}
          onNext={() => tourAdvance(false)}
          onSkipStep={() => {
            if (tourStep === 3) setShowSettings(true);
            tourAdvance(true);
          }}
          onSkipAll={finishTour}
          onFinish={finishTour}
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
  volumeGroup: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginLeft: "auto",
  },
  volumeSlider: {
    width: 90,
  },
  iconBtn: {
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    fontSize: 12,
    padding: "5px 10px",
  },
};
