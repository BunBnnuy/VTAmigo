import React, { useState, useEffect, useRef, useCallback } from "react";
import { Palette, Sun, Moon, Monitor, Settings as SettingsIcon, Music2, Pause, VolumeX, Volume2 } from "lucide-react";
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
import { parseVoiceCommand } from "./voiceCommands.js";
import { apiFetch, wsUrl } from "./api.js";
import { track } from "./analytics.js";
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
  provider: "claude",
  voiceURI: "",
  ttsRate: 1,
  ttsVolume: 1,
  ttsProvider: "windows",
  piperVoice: "",
  micMode: "off", // "off" | "voice" | "commands" | "full" — see App.jsx's voice.onTranscript handler
  micDeviceId: "",
  micLang: "es-ES",
  micLabel: "Streamer",
  micTitleDelimiter: "",
  botUsername: "",
  botToken: "",
  autoSendToChat: false,
  aiResponsesEnabled: true,
  ignoredUsers: "jonejo_ia, streamelements, nightbot, moobot, fossabot, streamlabs, soundalerts, wizebot, botisimo, coebot, sery_bot, kofistreambot, commanderroot, virgoproz, aparatchik, logviewer, electricallongboard, anotherttvviewer, twitchraidshadow",
};

// Every key a stored settings blob is allowed to carry. VTAmigo spent years
// as a Windows desktop app, and each feature retired in the move to a hosted
// web app left its keys behind in the localStorage of every existing user.
// Nothing reads them any more, yet App still syncs the whole blob up to the
// server once per login — so they would outlive the code that understood
// them, and reappear in any settings export. Drop them on load instead.
const KNOWN_SETTING_KEYS = new Set([
  ...Object.keys(DEFAULT_SETTINGS),
  // No default of its own: api.js reads it straight out of localStorage.
  "backendUrl",
]);

// Turns whatever is in localStorage into a settings object this build
// understands: legacy shapes are migrated, unknown keys are discarded, and
// anything missing falls back to DEFAULT_SETTINGS. Pure — exported so it can
// be tested without mounting the app.
export function migrateSettings(saved) {
  const raw = saved && typeof saved === "object" ? saved : {};
  const kept = {};
  for (const [key, value] of Object.entries(raw)) {
    if (KNOWN_SETTING_KEYS.has(key)) kept[key] = value;
  }
  return {
    ...DEFAULT_SETTINGS,
    ...kept,
    // Old on/off mic checkbox → the 4-way mic mode
    micMode: raw.micMode === undefined ? (raw.micEnabled ? "voice" : "off") : raw.micMode,
    panelLayout: mergePanelLayout(raw.panelLayout),
  };
}

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
      // Migrated, not raw: this is the one path that copies a browser's
      // settings blob onto the server, so it must not carry keys from
      // retired features up with it.
      const localSettings = migrateSettings(JSON.parse(localStorage.getItem("settings") || "{}"));
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
      return migrateSettings(JSON.parse(localStorage.getItem("settings") || "{}"));
    } catch {
      // Unreadable or malformed localStorage — start from the defaults.
      return migrateSettings({});
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
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState(null);
  const [micSpeaking, setMicSpeaking] = useState(false);
  const [videoState, setVideoState] = useState({ queue: [], defaultPlaylistId: null, nowPlaying: null });
  const [botStatus, setBotStatus] = useState("disconnected");
  const [activeBotUsername, setActiveBotUsername] = useState(null);
  const [usingSiteBot, setUsingSiteBot] = useState(false);
  const [micLastText, setMicLastText] = useState("");
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
  const countdownIntervalRef = useRef(null);
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

  // Mic "commands"/"full" mode — parse a final transcript for a spoken
  // request like "change the title to ..." and act on it via the same
  // Helix calls StreamSettingsPanel uses. Posts a system row into the chat
  // feed either way so the streamer gets feedback without looking away.
  const postCommandFeedback = useCallback((ok, text) => {
    setMessages((prev) => [...prev.slice(-199), {
      id: `cmd-${uid()}`,
      timestamp: Date.now(),
      isCommand: true,
      ok,
      text,
    }]);
  }, []);
  const runVoiceCommand = useCallback(async (text) => {
    const cmd = parseVoiceCommand(text);
    if (!cmd) return;
    try {
      if (cmd.type === "title") {
        let newTitle = cmd.value;
        const delimiter = settingsRef.current.micTitleDelimiter;
        if (delimiter) {
          const infoRes = await apiFetch("/stream/info");
          const info = await infoRes.json().catch(() => ({}));
          if (!infoRes.ok) throw new Error(info.error || `HTTP ${infoRes.status}`);
          const idx = (info.title || "").indexOf(delimiter);
          if (idx !== -1) newTitle = cmd.value + info.title.slice(idx);
        }
        const res = await apiFetch("/stream/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        postCommandFeedback(true, t("app.voiceCommand.titleChanged", { title: newTitle }));
      } else if (cmd.type === "category") {
        const searchRes = await apiFetch(`/stream/categories?query=${encodeURIComponent(cmd.value)}`);
        const searchData = await searchRes.json().catch(() => ({}));
        if (!searchRes.ok) throw new Error(searchData.error || `HTTP ${searchRes.status}`);
        const match = (searchData.categories || [])[0];
        if (!match) {
          postCommandFeedback(false, t("app.voiceCommand.categoryNotFound", { query: cmd.value }));
          return;
        }
        const res = await apiFetch("/stream/settings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameId: match.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        postCommandFeedback(true, t("app.voiceCommand.categoryChanged", { category: match.name }));
      }
    } catch (err) {
      postCommandFeedback(false, err.message === "MISSING_SCOPE"
        ? t("app.voiceCommand.missingScope")
        : t("app.voiceCommand.error", { error: err.message }));
    }
  }, [postCommandFeedback, t]);

  // Voice transcription — wire up transcript handler and sync settings.
  // Mode controls what a final transcript does: "voice"/"full" show it in
  // the chat feed and feed the AI buffer (same as the old always-on
  // behavior); "commands"/"full" also run it through runVoiceCommand.
  useEffect(() => {
    voice.onStateChange = () => {
      setMicActive(voice.running);
      setMicError(voice.error);
      setMicSpeaking(voice.speaking);
      setMicLastText(voice.lastText);
    };
    voice.onTranscript = (text) => {
      const mode = settingsRef.current.micMode;
      if (mode === "voice" || mode === "full") {
        const label = settingsRef.current.micLabel || "Streamer";
        const msg = { username: label, text, isVoice: true };
        setMessages((prev) => [...prev.slice(-199), {
          ...msg,
          id: `voice-${Date.now()}`,
          timestamp: Date.now(),
          color: "#00d4ff",
        }]);
        pushToBuffer({ username: label, text });
      }
      if (mode === "commands" || mode === "full") {
        runVoiceCommand(text);
      }
    };
  }, [pushToBuffer, runVoiceCommand]);

  const handleSendTyped = useCallback((text) => {
    // No optimistic local append here — the backend broadcasts a synthetic
    // "chat" WS message (tagged isTyped: true) right after it posts to
    // Twitch, and the ws.onmessage chat handler below is what actually adds
    // it to `messages`/the AI buffer. Adding it here too used to double it up.
    // Only typed Live Chat messages reach real Twitch chat — voice-to-text
    // transcripts (see voice.onTranscript above) stay local/AI-buffer only.
    apiFetch("/say-as-streamer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).then(async (r) => {
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        console.warn("[chat] failed to send typed message to Twitch chat:", d.error || r.status);
      }
    }).catch((e) => console.warn("[chat] failed to send typed message to Twitch chat:", e.message));
  }, []);

  // Apply mic settings whenever they change
  useEffect(() => {
    voice.setLang(settings.micLang);
  }, [settings.micLang]);

  useEffect(() => {
    voice.setDevice(settings.micDeviceId);
  }, [settings.micDeviceId]);

  useEffect(() => {
    if (settings.micMode !== "off") voice.start();
    else voice.stop();
  }, [settings.micMode]);

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
    tts.setPiper({ voice: settings.piperVoice });
  }, [settings.voiceURI, settings.ttsRate, settings.ttsVolume, settings.ttsProvider, settings.piperVoice]);

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
      startCountdown();
      return;
    }

    setLoading(true);

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
      if (!data.error) {
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
      }
    } catch (err) {
      setResponses((prev) => [
        ...prev.slice(-49),
        { id: uid(), timestamp: Date.now(), text: `Network error: ${err.message}`, error: true },
      ]);
    } finally {
      setLoading(false);
      startCountdown();
    }
  }, []);

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
        } else if (data.type === "twitch_event") {
          const event = data.event;
          // Show event as a special entry in the chat feed
          setMessages((prev) => [...prev.slice(-199), {
            id: event.id,
            timestamp: event.timestamp,
            username: event.username || "Twitch",
            text: formatEventText(event, t),
            color: "var(--accent)",
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
  }, [triggerResponse, pushToBuffer]);

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
          {/* decorative: the brand name is already in the adjacent span */}
          <img src={logo} alt="" style={styles.brandIcon} />
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
            <Palette size={14} color="var(--accent)" /> {t("app.overlayStudioBtn")}
          </button>
          <button
            style={styles.settingsBtn}
            onClick={cycleTheme}
            title={t("app.themeTitle", { theme: t(`app.theme${theme[0].toUpperCase()}${theme.slice(1)}`) })}
          >
            {theme === "light" ? <Sun size={14} color="var(--accent)" /> : theme === "dark" ? <Moon size={14} color="var(--accent)" /> : <Monitor size={14} color="var(--accent)" />}
          </button>
          <button
            style={styles.settingsBtn}
            data-tour="settings-btn"
            onClick={() => {
              setShowSettings(true);
              if (tourActive && tourStep === 3) setTourStep(4);
            }}
          >
            <SettingsIcon size={14} color="var(--accent)" /> {t("app.settingsBtn")}
          </button>
          {connected ? (
            <button style={{ ...styles.btn, background: "var(--red)" }} onClick={() => handleDisconnect(true)}>
              {t("app.disconnect")}
            </button>
          ) : (
            <button
              style={{ ...styles.btn, background: "var(--accent)", color: "var(--on-accent)" }}
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
          micMode: settings.micMode,
          micActive,
          micError,
          micSpeaking,
          micLastText,
          lang: settings.language,
          onMicModeChange: (mode) => {
            const ns = { ...settings, micMode: mode };
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
            <span style={{ ...styles.statusText, display: "inline-flex", alignItems: "center", gap: 5 }}>
              {videoState.nowPlaying.paused ? <Pause size={13} /> : <Music2 size={13} />} {videoState.nowPlaying.title}
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
          <span style={{ ...styles.statusText, display: "inline-flex" }}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.ttsVolume}
            onChange={(e) => updateSetting("ttsVolume", Number(e.target.value))}
            disabled={muted}
            style={{ ...styles.volumeSlider, "--pct": `${settings.ttsVolume * 100}%` }}
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
    color: "var(--accent-light)",
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
    background: "var(--accent)",
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
