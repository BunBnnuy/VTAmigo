// Guards the frontend half of the desktop-legacy purge: the retired features
// used to live in Settings as hidden-but-rendered sections, so "gone" has to
// mean gone from the DOM, and a stored settings blob from an old build must
// not resurrect their keys.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import Settings from "../src/Settings.jsx";
import { migrateSettings } from "../src/App.jsx";
import en from "../src/i18n/locales/en.js";

const BASE_SETTINGS = {
  language: "en",
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
  micMode: "off",
  ignoredUsers: "",
};

// createElement rather than JSX: this file is plain .js, which esbuild does
// not run through the JSX transform.
function renderSettings(overrides = {}) {
  return render(createElement(Settings, {
    settings: { ...BASE_SETTINGS, ...overrides },
    tier: "pro",
    onSave: vi.fn(),
    onClose: vi.fn(),
  }));
}

beforeEach(() => {
  // Settings fetches overlay URLs, the linked bot account and memory status
  // on mount. None of that affects which sections exist, so the requests are
  // left pending — resolving them would only add state updates (and act()
  // noise) after the assertions have already run.
  globalThis.fetch = vi.fn(() => new Promise(() => {}));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Settings no longer renders the retired desktop features", () => {
  // Each entry is a string the deleted section used to put on screen, taken
  // from the English locale so a renamed label can't quietly pass.
  const goneSections = [
    ["Reddit stories", en.settings.reddit.title],
    ["Reddit stories (subreddit field)", en.settings.reddit.subredditsLabel],
    ["YouTube peek", en.settings.youtube.title],
    ["YouTube peek (interval field)", en.settings.youtube.intervalLabel],
    ["screen watcher", en.settings.trivia.title],
    ["screen watcher (capture region)", en.settings.trivia.regionLabel],
    ["ElevenLabs (provider option)", en.settings.tts.elevenlabs],
    ["ElevenLabs (API key field)", en.settings.tts.elevenApiKey],
    ["VTube Studio", en.settings.vtube.title],
    ["VTube Studio (mouth parameter)", en.settings.vtube.mouthParam],
    ["tunnel client", en.settings.tunnel.title],
    ["tunnel client (.exe download)", en.settings.tunnel.download],
  ];

  it.each(goneSections)("has no %s section", (_label, text) => {
    renderSettings();
    expect(screen.queryByText(text)).toBeNull();
  });

  it("leaves no trace of the retired features anywhere in its markup", () => {
    const { container } = renderSettings();
    const markup = container.innerHTML.toLowerCase();
    // "vtube" is deliberately absent from this list: the avatar overlay
    // section's own title still reads "(no VTube Studio needed)", which is a
    // locale string owned by the i18n batch, not markup this batch emits.
    for (const needle of ["elevenlabs", "elevenlabskey", "screenwatch", "reddit", "tunnel-client"]) {
      expect(markup).not.toContain(needle);
    }
  });

  it("still offers the TTS providers that survived", () => {
    renderSettings();
    expect(screen.getByRole("option", { name: en.settings.tts.windows })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: en.settings.tts.piper })).toBeInTheDocument();
  });
});

describe("AI provider picker", () => {
  it("is selectable and keeps all four providers", () => {
    const { container } = renderSettings();
    // The label isn't wired to the control with htmlFor, so reach the select
    // through an option only it can have.
    const select = container.querySelector('option[value="agy"]').closest("select");
    expect(select).toBeEnabled();
    expect([...select.options].map((o) => o.value)).toEqual(["claude", "grok", "agy", "chatgpt"]);
  });

  it("no longer claims only Claude is available", () => {
    renderSettings();
    expect(screen.queryByText(en.settings.aiProvider.onlyClaude)).toBeNull();
  });
});

describe("migrateSettings", () => {
  it("drops keys left behind by the retired features", () => {
    const legacy = migrateSettings({
      basePrompt: "be nice",
      screenWatchEnabled: true,
      screenWatchInterval: 4,
      screenWatchRegion: "0,0,1920,1080",
      screenClickEnabled: true,
      screenAutoNavigate: true,
      idleRedditStories: true,
      subreddits: "es, confesiones",
      youtubePeekEnabled: true,
      elevenLabsKey: "sk_secret",
      elevenLabsVoiceId: "abc123",
      vtubeUrl: "ws://localhost:8001",
      vtubeMouthParam: "MouthOpen",
    });

    expect(legacy.basePrompt).toBe("be nice");
    for (const dead of [
      "screenWatchEnabled", "screenWatchInterval", "screenWatchRegion",
      "screenClickEnabled", "screenAutoNavigate", "idleRedditStories",
      "subreddits", "youtubePeekEnabled", "elevenLabsKey", "elevenLabsVoiceId",
      "vtubeUrl", "vtubeMouthParam",
    ]) {
      expect(legacy).not.toHaveProperty(dead);
    }
  });

  it("keeps the keys that are still real settings", () => {
    const kept = migrateSettings({
      tiktokUsername: "@someone",
      ttsProvider: "piper",
      piperVoice: "es_MX-claude-high",
      provider: "grok",
      // No default of its own, but api.js reads it straight from localStorage.
      backendUrl: "https://vtamigo.example",
    });

    expect(kept).toMatchObject({
      tiktokUsername: "@someone",
      ttsProvider: "piper",
      piperVoice: "es_MX-claude-high",
      provider: "grok",
      backendUrl: "https://vtamigo.example",
    });
  });

  it("fills in defaults for anything the stored blob is missing", () => {
    const fresh = migrateSettings({});
    expect(fresh.ttsProvider).toBe("windows");
    expect(fresh.micMode).toBe("off");
    expect(fresh.panelLayout.windows).toBeTruthy();
  });

  it("still migrates the pre-4-way mic checkbox", () => {
    expect(migrateSettings({ micEnabled: true }).micMode).toBe("voice");
    expect(migrateSettings({ micEnabled: false }).micMode).toBe("off");
    // An explicit mode always wins over the legacy checkbox.
    expect(migrateSettings({ micEnabled: true, micMode: "commands" }).micMode).toBe("commands");
  });

  it("survives a corrupt blob instead of throwing", () => {
    expect(migrateSettings(null).ttsProvider).toBe("windows");
    expect(migrateSettings("not an object").ttsProvider).toBe("windows");
  });
});
