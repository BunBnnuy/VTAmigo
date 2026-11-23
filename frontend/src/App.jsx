import React, { useState, useEffect, useRef, useCallback } from "react";
import { Palette, ScanFace, Sun, Moon, Monitor, Settings as SettingsIcon, Music2, Pause, VolumeX, Volume2, Users, Eye, Timer, Trophy, Crown, X } from "lucide-react";
import ChatFeed from "./ChatFeed.jsx";
import ResponsePanel from "./ResponsePanel.jsx";
import WindowManager, { DEFAULT_PANEL_LAYOUT, mergePanelLayout } from "./WindowManager.jsx";
import PanelsMenu from "./PanelsMenu.jsx";
import Settings from "./Settings.jsx";
import OnboardingTour from "./OnboardingTour.jsx";
import AnnouncementModal from "./AnnouncementModal.jsx";
import Login from "./Login.jsx";
import Pending from "./Pending.jsx";
import { tts } from "./TTSController.js";
import { voice, isChromeBrowser } from "./VoiceTranscription.js";
import { mergeTitleWithDelimiter, parseVoiceCommand } from "./voiceCommands.js";
import { isSongRequest, isShoutout } from "./chatCommands.js";
import { chatTts, extractChatTTSMessage, formatChatTTSMessage, DEFAULT_CHAT_TTS_TEMPLATE } from "./ChatTTSController.js";
import { DEFAULT_MIXER, sanitizeMixer, channelGain } from "./mixer.js";
import {
  CURRENT_ANNOUNCEMENT,
  shouldShowAnnouncement,
  readSeenVersion,
  markAnnouncementSeen,
} from "./announcements.js";
import { apiFetch, wsUrl } from "./api.js";
import { ChatConnection } from "./ChatConnection.js";
import { logError } from "./errorLogger.js";
import { track } from "./analytics.js";
import { detectLanguage, useTranslation } from "./i18n/index.js";
import { tierLimits, clampToTier } from "./tiers.js";
import { countUnplayed, markBeatUsed, pickNextBeat, previewBeats } from "./showScript.js";
import { startHostTicker } from "./hostTicker.js";
import logo from "./img/logo.png";

const TIER_LABELS = { free: "Free", basic: "Basic", advanced: "Advanced", pro: "Pro" };

// Owner-only autonomous-host defaults (ShowRunnerPanel + App's fast lane).
// Kept as its own object so migrateSettings can merge a partial saved blob
// instead of letting a missing key crash a read at stream time.
const DEFAULT_HOST_MODE = {
  enabled: false,
  coldOpenEnabled: true,
  coldOpenText: "¡Buenas! Ya estamos aquí un día más. Poneos cómodos y contadme en el chat qué queréis ver hoy.",
  fastLaneEnabled: true,
  fastLaneIdleSec: 45,
  fastLaneCooldownSec: 30,
  fastLaneLines: "¡Ey, {user}! Justo estábamos hablando de ti.\n{user} por aquí — bienvenido.\nTe leo, {user}.",
  firstReplyFast: true,
  firstReplyDelaySec: 2,
  // Rolling live script: generate a deck when few beats remain, speak one per
  // silence. 12-hour streams need this loop, not a single deck.
  scriptEnabled: true,
  scriptAuto: true,
  scriptNotes: "",
  scriptBeats: 14,
  scriptGapSec: 45,
  // Each beat is a 4-5 part story; this is the pause between its parts, the
  // natural window where chat can interrupt the bot.
  scriptPartGapSec: 2.5,
  scriptEveryMin: 8,
  scriptLowWater: 5,
};

const DEFAULT_SETTINGS = {
  language: detectLanguage(),
  panelLayout: DEFAULT_PANEL_LAYOUT,
  tiktokUsername: "",
  hostMode: DEFAULT_HOST_MODE,
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
  kittenVoice: "",
  kokoroVoice: "",
  fishVoice: "",
  // Where the bot's voice plays: "app" (this browser, default), "overlay" (the
  // Bot voice OBS browser source only) or "both".
  ttsOutput: "app",
  mixer: DEFAULT_MIXER,
  chatTtsEnabled: false,
  chatTtsCommand: "",
  chatTtsVoiceURI: "",
  chatTtsTemplate: DEFAULT_CHAT_TTS_TEMPLATE,
  // Where chat-command TTS ("!tts ...") plays: "app" (this browser, default),
  // "overlay" (the Chat TTS OBS overlay source) or "both".
  chatTtsOutput: "app",
  micMode: "off", // "off" | "voice" | "commands" | "full" — see App.jsx's voice.onTranscript handler
  micDeviceId: "",
  micLang: "es-ES",
  micLabel: "Streamer",
  micTitleDelimiter: "",
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

// Credential keys that must never live in the settings blob (localStorage,
// the POST /settings server sync, or an exported .json): the bot moved to
// the OAuth bot-link flow, whose tokens live only in the backend's encrypted
// users-table columns (see backend/auth.js setBotTwitchTokens). Old builds
// stored a manually-pasted bot token + username here, so they are stripped
// on load instead of lingering or syncing up to SQLite.
const LEGACY_CREDENTIAL_KEYS = ["botToken", "botUsername", "accessToken", "refreshToken", "oauthToken"];

// Turns whatever is in localStorage into a settings object this build
// understands: legacy shapes are migrated, unknown keys are discarded, and
// anything missing falls back to DEFAULT_SETTINGS. Pure — exported so it can
// be tested without mounting the app.
function sanitizeHostMode(saved) {
  const h = saved && typeof saved === "object" ? saved : {};
  return { ...DEFAULT_HOST_MODE, ...h };
}

export function migrateSettings(saved) {
  const raw = saved && typeof saved === "object" ? saved : {};
  const kept = {};
  for (const [key, value] of Object.entries(raw)) {
    if (KNOWN_SETTING_KEYS.has(key)) kept[key] = value;
  }
  // Belt and braces: even if a credential key ever lands back in
  // KNOWN_SETTING_KEYS, it must not survive migration.
  for (const key of LEGACY_CREDENTIAL_KEYS) delete kept[key];
  const out = {
    ...DEFAULT_SETTINGS,
    ...kept,
    // Old on/off mic checkbox → the 4-way mic mode
    micMode: raw.micMode === undefined ? (raw.micEnabled ? "voice" : "off") : raw.micMode,
    panelLayout: mergePanelLayout(raw.panelLayout),
    // Always a full host-mode object: a partially-saved blob (or a future
    // key) must not make the fast lane read `undefined` mid-stream.
    hostMode: sanitizeHostMode(raw.hostMode),
    // Always a full, clamped channel set — a partial/legacy blob can't drop a
    // channel or push a gain out of 0..1.
    mixer: sanitizeMixer(raw.mixer),
  };
  for (const key of LEGACY_CREDENTIAL_KEYS) delete out[key];
  return out;
}

// One-time cleanup for browsers that still carry a manually-pasted bot token
// from before the OAuth bot-link flow: drop the credential keys from the
// persisted blob in place so they are never read or synced again. Exported
// for testing; AppInner calls it on load and before the server sync.
export function scrubStoredSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem("settings") || "{}");
    if (raw && typeof raw === "object" && LEGACY_CREDENTIAL_KEYS.some((k) => k in raw)) {
      for (const key of LEGACY_CREDENTIAL_KEYS) delete raw[key];
      localStorage.setItem("settings", JSON.stringify(raw));
    }
  } catch {
    // Malformed blob — callers fall back to defaults; nothing to scrub.
  }
}

const HYPE_KEYWORDS = ["pogchamp", "pog", "omegalul", "lul", "kekw", "lets go", "let's go", "clip it", "letsgo", "hype"];
const BURST_SILENCE_MS = 3000; // how long silence after burst triggers response

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatSessionDuration(startedAt) {
  const ms = Math.max(0, Date.now() - new Date(startedAt).getTime());
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
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
      // retired features up with it. migrateSettings also strips the legacy
      // manually-pasted bot token, which must never reach SQLite — the
      // OAuth-linked bot tokens live only in the backend's encrypted columns.
      scrubStoredSettings();
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
  return <AppInner twitchLogin={authState.login} tier={authState.tier || "pro"} role={authState.role || "user"} onRefreshAuth={checkAuth} />;
}

function AppInner({ twitchLogin, tier, role, onRefreshAuth }) {
  // Roles are a separate axis from tiers (see backend/auth.js requireOwner).
  // `owner` is the only account that sees the VRM avatar and the autonomous
  // host; every other account gets the normal co-host dashboard.
  const isOwner = role === "owner";
  const [settings, setSettings] = useState(() => {
    try {
      // Scrub first so a legacy manually-pasted bot token is deleted from
      // the persisted blob, not just from this session's state.
      scrubStoredSettings();
      return migrateSettings(JSON.parse(localStorage.getItem("settings") || "{}"));
    } catch {
      // Unreadable or malformed localStorage — start from the defaults.
      return migrateSettings({});
    }
  });
  const { t, lang: uiLang } = useTranslation(settings.language);
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
  // Keep the document language in sync with the UI language once the app is
  // behind the landing, which sets its own `lang` from the picker.
  useEffect(() => {
    document.documentElement.lang = uiLang;
  }, [uiLang]);
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

  // Read once at mount, not from tourActive: that flips to false the moment a
  // new user finishes the tour, and reusing it would pop the changelog in
  // their face straight afterwards.
  const [announcement, setAnnouncement] = useState(() => {
    let isNewUser = false;
    try {
      isNewUser = localStorage.getItem("onboarding_done_v1") !== "1";
    } catch {
      // Unreadable storage — treat as an existing user and let the modal show.
    }
    return shouldShowAnnouncement({ seenVersion: readSeenVersion(), isNewUser }) ? CURRENT_ANNOUNCEMENT : null;
  });

  // Whenever the modal is *not* shown, record this release as seen anyway:
  // it catches a brand-new user up so the next release is their first real
  // announcement, and is a no-op for anyone who already dismissed this one.
  useEffect(() => {
    if (!announcement && CURRENT_ANNOUNCEMENT) markAnnouncementSeen(CURRENT_ANNOUNCEMENT.version);
    // Mount only: `announcement` becoming null on dismiss is handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismissAnnouncement = useCallback(() => {
    if (CURRENT_ANNOUNCEMENT) markAnnouncementSeen(CURRENT_ANNOUNCEMENT.version);
    setAnnouncement(null);
  }, []);

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
  const [lastShoutout, setLastShoutout] = useState(null);
  const [lastStreak, setLastStreak] = useState(null);
  const [botStatus, setBotStatus] = useState("disconnected");
  const [activeBotUsername, setActiveBotUsername] = useState(null);
  const [usingSiteBot, setUsingSiteBot] = useState(false);
  const [micLastText, setMicLastText] = useState("");
  const [nowCooldownUntil, setNowCooldownUntil] = useState(0);
  const [nowSessionUsed, setNowSessionUsed] = useState(0);
  const [, forceNowTick] = useState(0);
  const [achievementsState, setAchievementsState] = useState({
    achievements: [],
    totalPoints: 0,
    earnedTier: "free",
    tierThresholds: null,
  });
  const [toasts, setToasts] = useState([]);

  const wsRef = useRef(null);
  const connectAttemptRef = useRef(0);
  const seenMsgIds = useRef(new Set());
  const bufferRef = useRef([]);
  const [queuedCount, setQueuedCount] = useState(0);
  // Follower total from Twitch — shown even while offline (last known
  // value); only refreshed every 10 min while the stream is live. null
  // until the first successful fetch.
  const [followerTotal, setFollowerTotal] = useState(null);
  // Viewers + session timer — always visible. Values update only while
  // live; offline we keep the last known viewers and freeze the timer.
  const [viewerCount, setViewerCount] = useState(0);  const [streamStartedAt, setStreamStartedAt] = useState(null);
  const [streamLive, setStreamLive] = useState(false);
  // Rolling show-script decks (owner-only). Persisted server-side; the app
  // keeps the newest few in memory for the playout and the panel preview.
  const [scriptDecks, setScriptDecks] = useState([]);
  const [scriptState, setScriptState] = useState({ generating: false, error: "", lastAt: 0 });
  const [scriptJob, setScriptJob] = useState(null);
  const [sessionLabel, setSessionLabel] = useState("0:00:00");
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
  const firstReplyTimerRef = useRef(null);
  // Autonomous host bookkeeping: when the last real chat line arrived, when
  // the fast lane last spoke / the avatar last reacted (both throttled), who
  // has already spoken this session, and whether the cold open has fired.
  const lastChatAtRef = useRef(0);
  const lastFastLaneAtRef = useRef(0);
  const lastActAtRef = useRef(0);
  const seenChattersRef = useRef(new Set());
  const coldOpenFiredRef = useRef(false);
  const lastStreamStartedRef = useRef(null);
  // Live script bookkeeping. The refs mirror the latest state for the ticker
  // closures, which are created once per mount and must not go stale.
  const scriptDecksRef = useRef(scriptDecks);
  scriptDecksRef.current = scriptDecks;
  const scriptStateRef = useRef(scriptState);
  scriptStateRef.current = scriptState;
  const scriptBusyRef = useRef(false);
  const scriptLoadedRef = useRef(false);
  const scriptLastSpokeRef = useRef(0);
  const scriptLastQuestionRef = useRef(0);
  // Active multi-part story: { deckId, beatId, parts, partIndex, startedAt,
  // phase: "starting"|"speaking"|"gap", pendingSince, nextAt }. A story is
  // spoken part by part with a short pause, so chat can interrupt it.
  const storyRef = useRef(null);
  const ttsSpeakingRef = useRef(false);
  ttsSpeakingRef.current = ttsSpeaking;
  const loadingRef = useRef(false);
  loadingRef.current = loading;
  const connectedRef = useRef(false);
  connectedRef.current = connected;
  const streamLiveRef = useRef(false);
  streamLiveRef.current = streamLive;
  const hostContextRef = useRef({});
  hostContextRef.current = { messages, videoState, streamStartedAt, viewerCount };
  const countdownIntervalRef = useRef(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const mixerBroadcastRef = useRef(null);
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

  // Achievements — same fetch-on-mount reasoning as video/activity above:
  // the WS only pushes newly-earned unlocks, so without this a page refresh
  // would show an empty panel even though the backend kept the unlocks.
  const fetchAchievements = useCallback(() => {
    apiFetch("/achievements/state")
      .then((res) => res.json())
      .then((data) => setAchievementsState({
        achievements: data.achievements || [],
        totalPoints: data.totalPoints || 0,
        earnedTier: data.earnedTier || "free",
        tierThresholds: data.tierThresholds || null,
      }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchAchievements();
  }, [fetchAchievements]);

  const dismissToast = useCallback((key) => {
    setToasts((prev) => prev.filter((toast) => toast.key !== key));
  }, []);

  // Unlock toasts cap at 3 per burst — first-connect backfills can earn
  // several at once, and a wall of toasts would cover the canvas.
  const pushToast = useCallback((toast) => {
    const key = uid();
    const entry = { ...toast, key };
    setToasts((prev) => [...prev.slice(-4), entry]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.key !== key));
    }, 6000);
  }, []);

  // Header stream stats — poll Helix /streams every 60s for live/viewers/
  // startedAt. Followers are seeded once (even offline) and only refreshed
  // every 10 min while live via ?total=1 on the same endpoint.
  useEffect(() => {
    const LIVE_POLL_MS = 60 * 1000;
    const FOLLOWERS_REFRESH_MS = 10 * 60 * 1000;
    let cancelled = false;
    let timer = null;
    let live = false;
    let hasTotal = false;
    let lastFollowersFetch = 0;

    const poll = async () => {
      const now = Date.now();
      const wantTotal = !hasTotal || (live && now - lastFollowersFetch >= FOLLOWERS_REFRESH_MS);
      try {
        const res = await apiFetch(`/stream/followers${wantTotal ? "?total=1" : ""}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        live = !!data.live;
        setStreamLive(live);
        if (typeof data.total === "number") {
          hasTotal = true;
          lastFollowersFetch = now;
          setFollowerTotal(data.total);
        }
        // Viewers/timer only refresh while live; offline keeps last known.
        if (live) {
          setViewerCount(typeof data.viewerCount === "number" ? data.viewerCount : 0);
          setStreamStartedAt(data.startedAt || null);
        }
      } catch {
        // Transient network/Twitch errors — keep the last known stats.
      } finally {
        if (!cancelled) timer = setTimeout(poll, LIVE_POLL_MS);
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Session timer — tick locally while live; freeze the last value offline.
  useEffect(() => {
    if (!streamLive || !streamStartedAt) return undefined;
    const tick = () => setSessionLabel(formatSessionDuration(streamStartedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [streamLive, streamStartedAt]);

  // Auto-connect on mount — login always implies a channel now (the user's
  // own), so there's nothing to gate this on.
  useEffect(() => {
    handleConnect();
    if (settingsRef.current.tiktokUsername) handleTikTokConnect();
    return () => {
      connectAttemptRef.current += 1;
      if (wsRef.current) { wsRef.current.stop(); wsRef.current = null; }
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
          newTitle = mergeTitleWithDelimiter(cmd.value, info.title, delimiter);
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
    // Local playback gets the provider volume scaled by the bot-voice and
    // master mixer gains; the overlay receives the raw provider volume and
    // applies the same gains itself, so they are never applied twice.
    tts.setVolume(settings.ttsVolume * channelGain(settings.mixer, "botVoice"));
    tts.setOverlayVolume(settings.ttsVolume);
    tts.setProvider(settings.ttsProvider);
    tts.setOutput(settings.ttsOutput || "app");
    tts.setPiper({ voice: settings.piperVoice });
    tts.setKitten({ voice: settings.kittenVoice });
    tts.setKokoro({ voice: settings.kokoroVoice });
    tts.setFish({ voice: settings.fishVoice });
  }, [settings.voiceURI, settings.ttsRate, settings.ttsVolume, settings.ttsProvider, settings.piperVoice, settings.kittenVoice, settings.kokoroVoice, settings.fishVoice, settings.mixer, settings.ttsOutput]);

  // Chat command TTS is intentionally separate from the AI response TTS.
  useEffect(() => {
    chatTts.setVoice(settings.chatTtsVoiceURI);
  }, [settings.chatTtsVoiceURI]);

  useEffect(() => {
    chatTts.setVolume(channelGain(settings.mixer, "chatTts"));
  }, [settings.mixer]);

  useEffect(() => {
    chatTts.setOutput(settings.chatTtsOutput || "app");
  }, [settings.chatTtsOutput]);

  // The Mixer panel's gains are broadcast to this account's OBS overlays
  // (chat alerts, video queue, shoutouts, custom sound layers, voice overlay).
  // Debounced so dragging a slider doesn't fire a request per pixel.
  useEffect(() => {
    clearTimeout(mixerBroadcastRef.current);
    mixerBroadcastRef.current = setTimeout(() => {
      apiFetch("/mixer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mixer: settings.mixer }),
      }).catch(() => {});
    }, 250);
    return () => clearTimeout(mixerBroadcastRef.current);
  }, [settings.mixer]);

  useEffect(() => {
    chatTts.setEnabled(settings.chatTtsEnabled);
    return () => chatTts.stop();
  }, [settings.chatTtsEnabled]);

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

  // ── Autonomous host: fast lane + cold open ────────────────────────────────
  // Owner-only (role === "owner"). These paths never call the AI: they speak
  // an already-written line, so the first thing a new chatter hears is <1s
  // away instead of the 15–30s CLI round trip. The AI reply still follows
  // through the normal batch path below.

  const postVrmAct = useCallback((act, force = false) => {
    const now = Date.now();
    if (!force && now - lastActAtRef.current < 4000) return;
    lastActAtRef.current = now;
    apiFetch("/vrm-lab/act", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ act }),
    }).catch(() => {});
  }, []);

  const fastLaneLine = useCallback((username) => {
    const host = settingsRef.current.hostMode || {};
    if (host.fastLaneEnabled === false) return false;
    const lines = String(host.fastLaneLines || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return false;
    const line = lines[Math.floor(Math.random() * lines.length)]
      .replaceAll("{user}", username || "gente");
    tts.enqueue(line);
    lastFastLaneAtRef.current = Date.now();
    return true;
  }, []);

  const fireColdOpen = useCallback(async () => {
    const host = settingsRef.current.hostMode || {};
    if (host.coldOpenEnabled === false) return false;
    let text = String(host.coldOpenText || "").trim();
    if (!text) return false;
    // {game}/{title} come from Twitch's live channel info, fetched once at
    // open time — facts only, never invented by the model. If Helix is
    // unreachable the template speaks exactly as written.
    try {
      const res = await apiFetch("/stream/info");
      if (res.ok) {
        const info = await res.json();
        text = text
          .replaceAll("{game}", info.gameName || "")
          .replaceAll("{title}", info.title || "");
      }
    } catch {
      /* offline / missing scope: keep the template */
    }
    text = text.replace(/\s{2,}/g, " ").trim();
    if (!text) return false;
    tts.enqueue(text);
    postVrmAct("greeting", true);
    return true;
  }, [postVrmAct]);

  // ── Live show script: rolling generation + playout ────────────────────────
  // Generation is a background call every few minutes; playback only speaks
  // beats that were already validated. The model never runs at the moment the
  // bot opens its mouth.

  const generateScript = useCallback(async (reason = "manual") => {
    if (!isOwner || scriptBusyRef.current) return null;
    scriptBusyRef.current = true;
    setScriptState((s) => ({ ...s, generating: true, error: "" }));
    try {
      const h = hostContextRef.current || {};
      const host = settingsRef.current.hostMode || {};
      const uptimeMin = h.streamStartedAt
        ? Math.max(0, Math.round((Date.now() - new Date(h.streamStartedAt).getTime()) / 60000))
        : 0;
      const recentChat = (h.messages || [])
        .filter((m) => !m.isEvent && !m.isBot && m.text)
        .slice(-8)
        .map((m) => ({ username: m.username, text: m.text }));
      const res = await apiFetch("/host/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: settingsRef.current.language,
          count: host.scriptBeats || 14,
          context: {
            uptimeMin,
            viewerCount: h.viewerCount || 0,
            nowPlaying: h.videoState?.nowPlaying || null,
            queue: (h.videoState?.queue || []).slice(0, 5),
            recentChat,
            streamerNotes: host.scriptNotes || "",
            isFirstDeck: scriptDecksRef.current.length === 0,
            reason,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (!data.jobId) throw new Error("El servidor no devolvió un trabajo de generación");
      setScriptJob(data.jobId);
      return data.jobId;
    } catch (err) {
      // Back off for one interval instead of retrying every 30 s while the
      // provider is down. The current deck keeps playing in the meantime.
      scriptBusyRef.current = false;
      setScriptState((s) => ({ ...s, generating: false, error: err.message, lastAt: Date.now() }));
      return null;
    }
  }, [isOwner]);

  const consumeScriptBeat = useCallback((deckId, beatId) => {
    setScriptDecks((prev) => markBeatUsed(prev, deckId, beatId));
    // Local continuation decks exist only in this tab; there is nothing to
    // mark server-side for them.
    if (deckId.startsWith("local-")) return;
    apiFetch("/host/script/used", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckId, beatId }),
    }).catch(() => {});
  }, []);

  const beginStory = useCallback((deckId, beat) => {
    const parts = Array.isArray(beat.parts) && beat.parts.length ? beat.parts : [beat.text];
    if (!parts[0]) return false;
    const now = Date.now();
    storyRef.current = {
      deckId,
      beatId: beat.id,
      parts,
      partIndex: 0,
      startedAt: now,
      phase: "starting",
      pendingSince: now,
      nextAt: 0,
    };
    tts.enqueue(parts[0]);
    scriptLastSpokeRef.current = now;
    if (beat.kind === "question") scriptLastQuestionRef.current = now;
    consumeScriptBeat(deckId, beat.id);
    return true;
  }, [consumeScriptBeat]);

  // Ends the active story. On a chat interruption the unspoken parts are
  // re-queued as a local deck (oldest, so it resumes before new topics), so a
  // single message does not throw the rest of the anecdote away.
  const finishStory = useCallback((reason) => {
    const story = storyRef.current;
    if (!story) return;
    storyRef.current = null;
    if (reason !== "interrupted") return;
    const remaining = story.parts.slice(story.partIndex + 1);
    if (!remaining.length) return;
    const now = Date.now();
    const rid = globalThis.crypto?.randomUUID?.() || `${now}-${Math.random().toString(36).slice(2)}`;
    const localDeck = {
      id: `local-${rid}`,
      createdAt: now - 24 * 60 * 60 * 1000,
      beats: [{
        id: `local-beat-${rid}`,
        kind: "topic",
        text: remaining.join(" "),
        parts: remaining,
        afterMin: 0,
        beforeMin: 0,
      }],
      meta: { local: true },
    };
    setScriptDecks((prev) => [localDeck, ...prev].slice(0, 8));
  }, []);

  const speakScriptBeat = useCallback((deckId, beatId) => {
    if (storyRef.current || tts.playing || ttsSpeakingRef.current) return;
    const deck = scriptDecksRef.current.find((d) => d.id === deckId);
    const beat = deck?.beats?.find((b) => b.id === beatId);
    if (!beat || beat.usedAt) return;
    beginStory(deckId, beat);
  }, [beginStory]);

  const discardScriptDeck = useCallback((deckId) => {
    setScriptDecks((prev) => prev.filter((d) => d.id !== deckId));
    if (deckId.startsWith("local-")) return;
    apiFetch(`/host/script/${deckId}/discard`, { method: "POST" }).catch(() => {});
  }, []);

  const skipTts = useCallback(() => {
    // A manual skip ends the story without re-queueing the rest.
    storyRef.current = null;
    tts.skip();
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

  // A new stream (Twitch's startedAt changes) re-arms the cold open and drops
  // decks from the previous one. A mid-stream page reload keeps its startedAt,
  // so the decks already generated for this stream survive.
  useEffect(() => {
    coldOpenFiredRef.current = false;
    if (!streamStartedAt) return;
    const started = new Date(streamStartedAt).getTime();
    if (lastStreamStartedRef.current && started > lastStreamStartedRef.current + 10 * 60 * 1000) {
      setScriptDecks([]);
    }
    lastStreamStartedRef.current = started;
  }, [streamStartedAt]);

  // Cold open: the first thing on stream, before anyone has typed. Fires once
  // per live session a few seconds after the live flag flips, so the OBS
  // sockets are connected. Editing the text while live just resets the timer.
  useEffect(() => {
    const host = settings.hostMode || {};
    if (settings.aiResponsesEnabled === false) return undefined;
    if (!isOwner || !host.enabled || host.coldOpenEnabled === false) return undefined;
    if (!connected || !streamLive || coldOpenFiredRef.current) return undefined;
    const key = streamStartedAt ? `hostColdOpen:${twitchLogin || "me"}:${streamStartedAt}` : null;
    if (key) {
      try {
        if (localStorage.getItem(key) === "1") {
          coldOpenFiredRef.current = true;
          return undefined;
        }
      } catch {
        /* storage unavailable: fall back to the in-memory guard */
      }
    }
    const timer = setTimeout(async () => {
      if (coldOpenFiredRef.current) return;
      // Only mark it done once there was actually something to say, so an
      // empty template (or enabling host mode mid-stream) can still fire.
      const spoke = await fireColdOpen();
      if (spoke) {
        coldOpenFiredRef.current = true;
        if (key) {
          try {
            localStorage.setItem(key, "1");
          } catch {
            /* ignore */
          }
        }
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, [connected, streamLive, isOwner, settings.hostMode, settings.aiResponsesEnabled, fireColdOpen, streamStartedAt, twitchLogin]);

  // Load any decks left from an earlier page load / earlier in the stream, so
  // a refresh doesn't restart the show from zero. A running generation job is
  // resumed too.
  useEffect(() => {
    if (!isOwner) return undefined;
    let cancelled = false;
    Promise.all([
      apiFetch("/host/script").then((res) => (res.ok ? res.json() : null)).catch(() => null),
      apiFetch("/host/script/active").then((res) => (res.ok ? res.json() : null)).catch(() => null),
    ])
      .then(([data, active]) => {
        if (cancelled) return;
        if (data?.decks) {
          // A deck from a previous day is not useful: its facts (game, songs,
          // chat) are stale. Keep the last six hours.
          const cutoff = Date.now() - 6 * 60 * 60 * 1000;
          const fresh = data.decks.filter((deck) => deck.createdAt >= cutoff);
          setScriptDecks(fresh);
          setScriptState((s) => ({ ...s, lastAt: fresh[0]?.createdAt || 0 }));
        }
        if (active?.job?.jobId) {
          scriptBusyRef.current = true;
          setScriptState((s) => ({ ...s, generating: true, error: "" }));
          setScriptJob(active.job.jobId);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) scriptLoadedRef.current = true;
      });
    return () => {
      cancelled = true;
      scriptLoadedRef.current = false;
    };
  }, [isOwner]);

  // Poll the background generation job. The POST returns immediately, so a
  // 2-3 minute story deck never holds an HTTP request open long enough for a
  // proxy to 504 it.
  useEffect(() => {
    if (!scriptJob) return undefined;
    let cancelled = false;
    const startedAt = Date.now();
    const finish = (patch) => {
      if (cancelled) return;
      scriptBusyRef.current = false;
      setScriptJob(null);
      setScriptState((s) => ({ ...s, ...patch }));
    };
    const tick = async () => {
      try {
        const res = await apiFetch(`/host/script/status/${encodeURIComponent(scriptJob)}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.status === 404) {
          finish({ generating: false, error: "La generación se perdió (el servidor se reinició)", lastAt: Date.now() });
          return;
        }
        if (!res.ok) {
          finish({ generating: false, error: data.error || `HTTP ${res.status}`, lastAt: Date.now() });
          return;
        }
        if (data.status === "done" && data.deck) {
          setScriptDecks((prev) =>
            prev.some((deck) => deck.id === data.deck.id)
              ? prev
              : [data.deck, ...prev].slice(0, 8)
          );
          finish({ generating: false, error: "", lastAt: Date.now() });
          return;
        }
        if (data.status === "error") {
          finish({ generating: false, error: data.error || "El modelo no devolvió un guion válido", lastAt: Date.now() });
          return;
        }
        if (Date.now() - startedAt > 5 * 60 * 1000) {
          finish({ generating: false, error: "La generación tardó demasiado", lastAt: Date.now() });
        }
      } catch {
        /* transient network error: keep polling */
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [scriptJob]);
  // Playout: a beat is a 4-5 part story. Parts are spoken back to back with
  // a short pause between them; a new chat line (or a pending AI reply)
  // interrupts after the current part and the unspoken parts are re-queued.
  // The worker ticker keeps this running while the dashboard tab is hidden.
  useEffect(() => {
    if (!isOwner) return undefined;
    return startHostTicker(() => {
      const host = settingsRef.current.hostMode || {};
      if (!host.enabled || host.scriptEnabled === false) {
        storyRef.current = null;
        return;
      }
      if (settingsRef.current.aiResponsesEnabled === false || tts.muted) {
        storyRef.current = null;
        return;
      }

      const now = Date.now();
      const story = storyRef.current;

      if (story) {
        // A new viewer message or a pending AI reply wins over the story.
        if (lastChatAtRef.current > story.startedAt || loadingRef.current) {
          finishStory("interrupted");
          return;
        }

        const speaking = tts.playing || ttsSpeakingRef.current;

        if (story.phase === "starting") {
          if (speaking) story.phase = "speaking";
          else if (now - story.pendingSince > 15000) {
            // The provider never produced audio for this part; drop the story
            // instead of looping on a broken line.
            storyRef.current = null;
          }
          return;
        }

        if (story.phase === "speaking") {
          if (!speaking) {
            story.phase = "gap";
            story.nextAt = now + Math.max(1, host.scriptPartGapSec ?? 2.5) * 1000;
          }
          return;
        }

        if (story.phase === "gap") {
          if (now < story.nextAt) return;
          const nextIndex = story.partIndex + 1;
          if (nextIndex >= story.parts.length) {
            storyRef.current = null;
            scriptLastSpokeRef.current = now;
            return;
          }
          story.partIndex = nextIndex;
          story.phase = "starting";
          story.pendingSince = now;
          tts.enqueue(story.parts[nextIndex]);
          return;
        }
        return;
      }

      // No story in flight: start one when the room has been quiet long enough.
      if (loadingRef.current || tts.playing || ttsSpeakingRef.current) return;
      const gap = Math.max(10, host.scriptGapSec || 45) * 1000;
      if (now - lastChatAtRef.current < gap) return;
      if (now - scriptLastSpokeRef.current < gap) return;
      const beat = pickNextBeat(scriptDecksRef.current, now, {
        viewerCount: hostContextRef.current?.viewerCount || 0,
        lastQuestionAt: scriptLastQuestionRef.current,
      });
      if (!beat) return;
      beginStory(beat.deckId, beat);
    }, 1000);
  }, [isOwner, beginStory, finishStory]);

  // Rolling generation: refill before the deck runs dry. Low-water mark plus
  // a minimum interval keeps a 12-hour stream at a handful of calls per hour
  // instead of one per silence.
  useEffect(() => {
    if (!isOwner) return undefined;
    return startHostTicker(() => {
      const host = settingsRef.current.hostMode || {};
      if (!host.enabled || host.scriptEnabled === false || host.scriptAuto === false) return;
      if (settingsRef.current.aiResponsesEnabled === false) return;
      if (!scriptLoadedRef.current) return;
      if (!connectedRef.current || !streamLiveRef.current) return;
      const now = Date.now();
      const minGap = Math.max(3, host.scriptEveryMin || 8) * 60_000;
      if (now - (scriptStateRef.current.lastAt || 0) < minGap) return;
      if (countUnplayed(scriptDecksRef.current, now) > Math.max(1, host.scriptLowWater || 5)) return;
      generateScript("auto");
    }, 30_000);
  }, [isOwner, generateScript]);

  // ── WebSocket ─────────────────────────────────────────────────────────────

  const connectWS = useCallback(() => {
    wsRef.current?.stop();
    const onMessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.type === "chat") {
          const msg = data.msg;
          const commandText = extractChatTTSMessage(msg.text, settingsRef.current.chatTtsCommand);
          if (commandText && settingsRef.current.chatTtsEnabled) {
            chatTts.enqueue(formatChatTTSMessage(
              settingsRef.current.chatTtsTemplate,
              msg.username,
              commandText,
            ));
          }
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
          // App commands (a song request for the video queue, or a mod's
          // shoutout) are instructions to the app, not something said to the
          // co-host: they stay in the chat feed but never reach the AI buffer,
          // so the bot doesn't reply to "!sr <song>" or "!so <user>".
          const appCommand = isSongRequest(msg.text) || isShoutout(msg.text);
          if (!appCommand) {
            pushToBuffer({
              username: msg.username,
              text: msg.text,
              isRedeem: msg.isRedeem || false,
              rewardTitle: msg.rewardTitle || null,
            });
          }
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

          // ── Autonomous host: react before the AI does ──────────────────
          // The avatar acknowledges in the same frame; the fast lane speaks a
          // canned line when the room has been quiet (or the chatter is new),
          // and the first message after a long silence short-circuits the
          // batch window instead of waiting it out. None of this touches the
          // AI: it is what the viewer hears while the model is still thinking.
          const host = settingsRef.current.hostMode || {};
          if (isOwner && host.enabled && settingsRef.current.aiResponsesEnabled !== false) {
            const now = Date.now();
            const idleMs = now - (lastChatAtRef.current || 0);
            const key = String(msg.username || "").toLowerCase();
            const firstFromUser = !!key && !seenChattersRef.current.has(key);
            if (key) seenChattersRef.current.add(key);
            lastChatAtRef.current = now;

            postVrmAct("listening");

            const cooldownMs = Math.max(5, host.fastLaneCooldownSec || 30) * 1000;
            if (
              !appCommand &&
              host.fastLaneEnabled !== false &&
              (firstFromUser || idleMs > Math.max(5, host.fastLaneIdleSec || 45) * 1000) &&
              now - lastFastLaneAtRef.current > cooldownMs
            ) {
              fastLaneLine(msg.username);
            }

            if (!appCommand && host.firstReplyFast !== false && idleMs > 60_000) {
              clearTimeout(firstReplyTimerRef.current);
              firstReplyTimerRef.current = setTimeout(() => {
                if (bufferRef.current.length && settingsRef.current.aiResponsesEnabled !== false) {
                  triggerResponse();
                }
              }, Math.max(1, host.firstReplyDelaySec || 2) * 1000);
            }
          }

          // Burst detection: lots of hype → wait for silence then fire.
          // Excluded for app commands too — a title that happens to contain
          // "pog" or "let's go" shouldn't schedule a response the buffer never
          // received the message for.
          const isHype = !appCommand && HYPE_KEYWORDS.some((kw) => msg.text.toLowerCase().includes(kw));
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
        } else if (data.type === "shoutout") {
          const { type, ...shoutoutData } = data;
          setLastShoutout(shoutoutData);
        } else if (data.type === "bot_status") {
          setBotStatus(data.status.type);
          if (data.botUsername) setActiveBotUsername(data.botUsername);
          setUsingSiteBot(!!data.usingSiteBot);
        } else if (data.type === "tts_state") {
          // Emitted by whichever player is actually audible. In "overlay"/"both"
          // mode that is the OBS voice overlay, so this is what keeps the Skip
          // button and the avatar panel's speaking state in sync with it. In
          // "app" mode the local queue already owns ttsPlaying, and a stale
          // "stop" from the previous clip must not hide Skip mid-generation.
          setTtsSpeaking(!!data.playing);
          if ((settingsRef.current.ttsOutput || "app") !== "app") setTtsPlaying(!!data.playing);
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
          // Watch streaks (USERNOTICE viewermilestone) feed the panel's "last
          // streak" line. They are informational milestones, not prompts, so
          // they must not trigger an AI response — everything else still does.
          if (event.kind === "streak") setLastStreak(event);
          else triggerEventResponse(event);
        } else if (data.type === "achievement_unlocked") {
          // Toast from the WS payload (authoritative names come from the
          // panel's own i18n keys at render time), panel state via refetch.
          const unlocked = data.achievements || [];
          for (const a of unlocked.slice(0, 3)) {
            pushToast({ kind: "achievement", id: a.id, points: a.points });
          }
          if (unlocked.length > 3) {
            pushToast({ kind: "more", count: unlocked.length - 3 });
          }
          fetchAchievements();
        } else if (data.type === "tier_upgraded") {
          // Live tier upgrade with no page reload: re-fetching /auth/me
          // pushes the new tier down through props (brand line, batching
          // clamps via tierRef), and the achievements panel refetches too.
          pushToast({ kind: "tier", tier: data.newTier });
          onRefreshAuthRef.current?.();
          fetchAchievements();
        }
      } catch {
        // ignore parse errors
      }
    };
    const connection = new ChatConnection({
      url: () => wsUrl("/chat"),
      onOpen: () => { setConnected(true); setConnStatus("connecting"); },
      onClose: () => { setConnected(false); setConnStatus("disconnected"); },
      onDiagnostic: (details) => logError("chat.websocket", new Error(JSON.stringify(details))),
      onMessage,
    });
    wsRef.current = connection;
    connection.start();
  }, [triggerResponse, pushToBuffer, triggerEventResponse, pushToast, fetchAchievements, fastLaneLine, postVrmAct, isOwner]);

  // ── Twitch connect / disconnect ───────────────────────────────────────────

  const handleConnect = useCallback(async (manual) => {
    const attempt = ++connectAttemptRef.current;
    try {
      // The bot account is resolved server-side from the OAuth-linked bot
      // (/bot-link/*) or the site-wide fallback — no credentials travel here.
      const res = await apiFetch("/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual: !!manual }),
      });
      if (attempt !== connectAttemptRef.current) return;
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setConnStatus("error");
        alert(d.error || `HTTP ${res.status}`);
        return;
      }
      connectWS();
      startCountdown();
    } catch (err) {
      if (attempt === connectAttemptRef.current) setConnStatus("error");
    }
  }, [connectWS]);

  const handleDisconnect = useCallback(async (manual) => {
    connectAttemptRef.current += 1;
    clearTimeout(batchTimerRef.current);
    clearInterval(countdownIntervalRef.current);
    clearTimeout(burstTimerRef.current);
    setCountdown(null);
    if (wsRef.current) { wsRef.current.stop(); wsRef.current = null; }
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

  // Bulk version for controls that must change several keys atomically, like
  // the unified voice picker (one choice selects both engine and voice).
  const updateSettings = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem("settings", JSON.stringify(next));
      return next;
    });
  }, []);

  // Mixer panel: set one channel gain (0..1) and persist. The TTS/mixer effect
  // above re-applies it to local playback; the debounced POST broadcasts it to
  // this account's OBS overlays.
  const updateMixer = useCallback((channel, value) => {
    setSettings((prev) => {
      const next = { ...prev, mixer: { ...prev.mixer, [channel]: value } };
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
          {followerTotal != null && (
            <span style={styles.statBadge} title={t("app.followersTitle")}>
              <Users size={14} />
              {t("app.followers", { count: followerTotal.toLocaleString() })}
            </span>
          )}
          <span style={styles.statBadge} title={t("app.viewersTitle")}>
            <Eye size={14} />
            {t("app.viewers", { count: viewerCount.toLocaleString() })}
          </span>
          <span style={styles.statBadge} title={t("app.sessionTitle")}>
            <Timer size={14} />
            {sessionLabel}
          </span>
        </div>
        <div style={styles.topRight}>
          <PanelsMenu panelLayout={settings.panelLayout} onUpdateWindow={updateWindowLayout} t={t} isOwner={isOwner} />
          {isOwner && (
            <button
              style={styles.settingsBtn}
              onClick={() => window.open("/vrm-lab.html", "_blank")}
              title={t("app.vrmLabTitle")}
            >
              <ScanFace size={14} color="var(--accent)" /> {t("app.vrmLabBtn")}
            </button>
          )}
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
          onSkipTts: skipTts,
          nowDisabled,
          nowOnCooldown,
          nowRemainingSec,
          nowTitle,
          onNowClick: handleNowClick,
          settings,
          onUpdateSetting: updateSetting,
          onUpdateSettings: updateSettings,
          lang: settings.language,
          queuedCount,
          onPruneQueue: pruneQueue,
        }}
        avatarPanelProps={{ ttsSpeaking }}
        videoQueueProps={{ videoState }}
        shoutoutProps={{ lastShoutout }}
        streakProps={{ lastStreak, mixer: settings.mixer }}
        activityPanelProps={{ events: activityEvents, lang: settings.language }}
        achievementsPanelProps={{
          achievements: achievementsState.achievements,
          totalPoints: achievementsState.totalPoints,
          earnedTier: achievementsState.earnedTier,
          tierThresholds: achievementsState.tierThresholds,
        }}
        chatTtsPanelProps={{
          enabled: settings.chatTtsEnabled,
          command: settings.chatTtsCommand,
          voiceURI: settings.chatTtsVoiceURI,
          template: settings.chatTtsTemplate,
          output: settings.chatTtsOutput,
          onUpdateSetting: updateSetting,
        }}
        mixerPanelProps={{
          mixer: settings.mixer,
          onChange: updateMixer,
        }}
        showRunnerProps={{
          settings,
          onUpdateSettings: updateSettings,
          onTestGreeting: () => fastLaneLine(twitchLogin || "gente"),
          onTestColdOpen: fireColdOpen,
          onTestAct: () => postVrmAct("greeting", true),
          streamLive,
          scriptDecks,
          scriptState,
          onGenerateScript: () => generateScript("manual"),
          onSpeakBeat: speakScriptBeat,
          onDiscardDeck: discardScriptDeck,
        }}
        isOwner={isOwner}
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

        {/* Bot status — the login comes from the server (WS bot_status /
            OAuth-linked account), never from client settings: no token or
            username is stored in the browser any more. */}
        {activeBotUsername && (
          <div style={styles.statusGroup}>
            <span style={{
              ...styles.dot,
              background: botStatus === "connected" ? "var(--green)" : botStatus === "connecting" ? "var(--yellow)" : "var(--red)",
            }} />
            <span style={styles.statusText}>
              {t("app.botLine", {
                status: botStatus === "connected"
                  ? `${activeBotUsername}${usingSiteBot ? t("app.botSiteSuffix") : ""}`
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

      {/* ── Achievement / tier-upgrade toasts ── */}
      {toasts.length > 0 && (
        <div style={styles.toasts}>
          {toasts.map((toast) => (
            <div key={toast.key} style={styles.toast}>
              {toast.kind === "achievement" && <Trophy size={16} color="var(--yellow)" />}
              {toast.kind === "tier" && <Crown size={16} color="var(--accent)" />}
              <span style={styles.toastText}>
                {toast.kind === "achievement"
                  ? t("app.achievementUnlocked", {
                      name: t(`achievementsPanel.items.${toast.id}.name`),
                      points: toast.points,
                    })
                  : toast.kind === "tier"
                    ? t("app.tierUpgraded", { tier: TIER_LABELS[toast.tier] || toast.tier })
                    : t("app.achievementMore", { count: toast.count })}
              </span>
              <button style={styles.toastClose} onClick={() => dismissToast(toast.key)}>
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

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

      {announcement && (
        <AnnouncementModal
          announcement={announcement}
          lang={settings.language}
          onClose={dismissAnnouncement}
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
  statBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    marginLeft: 4,
    padding: "3px 9px",
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text)",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 9,
    fontFamily: "Quicksand, sans-serif",
    fontVariantNumeric: "tabular-nums",
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
  toasts: {
    position: "fixed",
    right: 16,
    bottom: 56,
    zIndex: 1500,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    maxWidth: 360,
  },
  toast: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderLeft: "3px solid var(--accent)",
    borderRadius: 9,
    boxShadow: "var(--shadow)",
    padding: "10px 12px",
  },
  toastText: {
    flex: 1,
    fontSize: 13,
    color: "var(--text)",
  },
  toastClose: {
    background: "transparent",
    border: "none",
    color: "var(--text-muted)",
    padding: "2px 4px",
    flexShrink: 0,
  },
};
