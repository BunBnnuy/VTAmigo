// Guards the frontend half of Security Issue 4: the Twitch bot token must
// never live in the browser's settings blob (localStorage), the POST
// /settings sync payload, or an exported .json file. The OAuth bot-link flow
// is the sole method now — Settings shows only the linked account's login,
// never a token value.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import Settings from "../src/Settings.jsx";
import { migrateSettings, scrubStoredSettings } from "../src/App.jsx";
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
  const onSave = vi.fn();
  const rendered = render(createElement(Settings, {
    settings: { ...BASE_SETTINGS, ...overrides },
    tier: "pro",
    onSave,
    onClose: vi.fn(),
  }));
  return { onSave, ...rendered };
}

// In-memory stand-in for localStorage (same shape as the fake in
// announcements.test.js) — the test env provides no real one.
function fakeLocalStorage(initial = {}) {
  let data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    clear: () => { data = {}; },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeLocalStorage());
  // Settings fetches overlay URLs, the linked bot account and memory status
  // on mount; leave those pending — resolving them only adds state updates
  // (and act() noise) after the assertions have already run.
  globalThis.fetch = vi.fn(() => new Promise(() => {}));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("migrateSettings drops legacy bot credentials", () => {
  it("strips botToken/botUsername (and sibling token keys) from an old blob", () => {
    const out = migrateSettings({
      language: "en",
      basePrompt: "be nice",
      botToken: "oauth:super-secret-token",
      botUsername: "somebot",
      accessToken: "x",
      refreshToken: "y",
      oauthToken: "z",
    });
    expect(out.basePrompt).toBe("be nice");
    for (const dead of ["botToken", "botUsername", "accessToken", "refreshToken", "oauthToken"]) {
      expect(out).not.toHaveProperty(dead);
    }
  });

  it("no longer has bot credentials among the defaults", () => {
    const fresh = migrateSettings({});
    expect(fresh).not.toHaveProperty("botToken");
    expect(fresh).not.toHaveProperty("botUsername");
  });

  it("still keeps the keys that are real settings", () => {
    const kept = migrateSettings({ tiktokUsername: "@someone", ttsProvider: "piper" });
    expect(kept).toMatchObject({ tiktokUsername: "@someone", ttsProvider: "piper" });
  });
});

describe("scrubStoredSettings (localStorage migration)", () => {
  it("deletes legacy credential keys from the persisted blob in place", () => {
    localStorage.setItem("settings", JSON.stringify({
      language: "en",
      botToken: "oauth:super-secret-token",
      botUsername: "somebot",
    }));
    scrubStoredSettings();
    const raw = JSON.parse(localStorage.getItem("settings"));
    expect(raw).toMatchObject({ language: "en" });
    expect(raw).not.toHaveProperty("botToken");
    expect(raw).not.toHaveProperty("botUsername");
  });

  it("leaves a clean blob untouched", () => {
    localStorage.setItem("settings", JSON.stringify({ language: "en" }));
    scrubStoredSettings();
    expect(JSON.parse(localStorage.getItem("settings"))).toEqual({ language: "en" });
  });

  it("does not throw on a malformed blob", () => {
    localStorage.setItem("settings", "{not json");
    expect(() => scrubStoredSettings()).not.toThrow();
  });
});

describe("Settings UI is OAuth-only", () => {
  it("renders no manual token/username inputs, only the link flow", () => {
    const { container } = renderSettings();
    // Dead-locale-guard style: these are the literal English labels the
    // manual fields used to render.
    expect(screen.queryByText(en.settings.bot.token)).toBeNull();
    expect(screen.queryByText(en.settings.bot.username)).toBeNull();
    expect(container.querySelector('input[type="password"]')).toBeNull();
    // The OAuth link flow stays: the connect button is still offered.
    expect(screen.getByRole("button", { name: new RegExp(en.settings.bot.connect.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeInTheDocument();
  });

  it("never displays a token value, only the linked login", () => {
    renderSettings({ botToken: "oauth:super-secret-token", botUsername: "somebot" });
    expect(document.body.textContent).not.toContain("oauth:super-secret-token");
  });

  it("strips credentials from the payload handed to onSave", () => {
    const { onSave } = renderSettings({ botToken: "oauth:super-secret-token", botUsername: "somebot" });
    fireEvent.click(screen.getByRole("button", { name: en.settings.save }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0];
    expect(saved).not.toHaveProperty("botToken");
    expect(saved).not.toHaveProperty("botUsername");
    expect(saved.language).toBe("en");
  });

  it("strips credentials from the exported .json file", async () => {
    const blobs = [];
    window.URL.createObjectURL = vi.fn((blob) => { blobs.push(blob); return "blob:mock"; });
    window.URL.revokeObjectURL = vi.fn();
    window.HTMLAnchorElement.prototype.click = vi.fn();

    renderSettings({ botToken: "oauth:super-secret-token", botUsername: "somebot" });
    // getByText rather than getByRole: the lucide icon inside the button
    // leaves the accessible-name computation brittle; the label text is exact.
    const downloadLabel = screen.getByText(en.settings.copySettings.download);
    fireEvent.click(downloadLabel.closest("button") || downloadLabel);

    expect(blobs).toHaveLength(1);
    // jsdom's Blob has no .text(), so read it back the same way the app's
    // own settings-import path does.
    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsText(blobs[0]);
    });
    expect(text).not.toContain("oauth:super-secret-token");
    expect(text).not.toContain("botToken");
    expect(JSON.parse(text).language).toBe("en");
  });
});
