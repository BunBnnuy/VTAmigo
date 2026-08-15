// Locale parity. Every string the UI can ask for goes through
// `translate(lang, key)`, which silently falls back to English and then to the
// raw key itself when a lookup misses — so a locale that drifts out of sync
// fails invisibly at runtime, showing English (or a bare "settings.foo.bar")
// to the user. This suite is the thing that notices.
//
// English is the reference locale: it is the fallback in i18n/index.js, so it
// must be a superset of every other locale, and no locale may carry a key that
// English lacks (such a key is either a typo or a leftover from a deleted
// feature).
import { describe, expect, it } from "vitest";
import { LOCALES, SUPPORTED_LANGUAGES } from "../src/i18n/index.js";

const REFERENCE = "en";

// ── Known, pre-existing translation gaps ────────────────────────────────────
// These are NOT acceptable long-term — they are a snapshot of what was already
// untranslated when this test was written, recorded so the suite can be green
// without deleting anyone's translations or inventing new ones. When a gap is
// filled, delete its entry here: the test fails on stale entries too, so the
// list cannot rot into a permanent excuse.

// Features shipped after the es/ja/ko passes were last run: the panel
// show/hide and TTS volume header controls, the Quick Controls message queue,
// the "AI responses are off" tooltip, and the whole Stream Settings panel.
const UNTRANSLATED_OUTSIDE_EN = [
  "app.nowAiResponsesDisabled",
  "app.panelsTitle",
  "app.ttsVolumeTitle",
  "quickControls.aiResponses",
  "quickControls.prune",
  "quickControls.pruneTitle",
  "quickControls.queued",
  "streamSettingsPanel.categoryLabel",
  "streamSettingsPanel.categorySearchPlaceholder",
  "streamSettingsPanel.collapse",
  "streamSettingsPanel.expand",
  "streamSettingsPanel.loadError",
  "streamSettingsPanel.logout",
  "streamSettingsPanel.noResults",
  "streamSettingsPanel.save",
  "streamSettingsPanel.saveError",
  "streamSettingsPanel.saved",
  "streamSettingsPanel.saving",
  "streamSettingsPanel.scopeErrorBody",
  "streamSettingsPanel.scopeErrorTitle",
  "streamSettingsPanel.title",
  "streamSettingsPanel.titleLabel",
  "streamSettingsPanel.titlePlaceholder",
];

// The chat overlay's "speech bubbles" theme and its alert-wording controls.
// Spanish got them; Japanese and Korean did not.
const BUBBLE_THEME_UNTRANSLATED = [
  "chatOverlayPanel.alertColor",
  "chatOverlayPanel.alertCopyHint",
  "chatOverlayPanel.alertCopySection",
  "chatOverlayPanel.allCaps",
  "chatOverlayPanel.bubbleColors",
  "chatOverlayPanel.bubbleHint",
  "chatOverlayPanel.bubbleSection",
  "chatOverlayPanel.cheerAlertMessage",
  "chatOverlayPanel.flower2Fill",
  "chatOverlayPanel.flower2Leaf",
  "chatOverlayPanel.flowerBorder",
  "chatOverlayPanel.flowerCenter",
  "chatOverlayPanel.flowerFill",
  "chatOverlayPanel.flowerLeaf",
  "chatOverlayPanel.followAlertMessage",
  "chatOverlayPanel.fontSizeAlertUsername",
  "chatOverlayPanel.fontSizeMessage",
  "chatOverlayPanel.fontSizeUsername",
  "chatOverlayPanel.fontWeightAlertUsername",
  "chatOverlayPanel.fontWeightMessage",
  "chatOverlayPanel.fontWeightUsername",
  "chatOverlayPanel.giftedSubAlertMessage",
  "chatOverlayPanel.ignoreCommands",
  "chatOverlayPanel.messageBackground",
  "chatOverlayPanel.messageBorder",
  "chatOverlayPanel.messageColor",
  "chatOverlayPanel.raidAlertMessage",
  "chatOverlayPanel.redeemAlertMessage",
  "chatOverlayPanel.resubAlertMessage",
  "chatOverlayPanel.showBadges",
  "chatOverlayPanel.showDecorations",
  "chatOverlayPanel.subAlertMessage",
  "chatOverlayPanel.theme",
  "chatOverlayPanel.themeBubbles",
  "chatOverlayPanel.themeDefault",
  "chatOverlayPanel.themeSwitchHint",
  "chatOverlayPanel.usernameColor",
];

const KNOWN_GAPS = {
  es: UNTRANSLATED_OUTSIDE_EN,
  ja: [...UNTRANSLATED_OUTSIDE_EN, ...BUBBLE_THEME_UNTRANSLATED],
  ko: [...UNTRANSLATED_OUTSIDE_EN, ...BUBBLE_THEME_UNTRANSLATED],
};

// Walks the locale object depth-first and returns every leaf key as a dotted
// path. Only leaves count: an intermediate object is just structure, and two
// locales that agree on every leaf necessarily agree on the shape above them.
function leafKeys(node, prefix = "", out = []) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      leafKeys(value, path, out);
    } else {
      out.push(path);
    }
  }
  return out;
}

const keysOf = Object.fromEntries(
  Object.entries(LOCALES).map(([lang, dict]) => [lang, new Set(leafKeys(dict))]),
);
const otherLocales = Object.keys(LOCALES).filter((lang) => lang !== REFERENCE);

describe("locale registry", () => {
  it("exposes a dictionary for every language offered in the picker", () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code).sort()).toEqual(Object.keys(LOCALES).sort());
  });

  it("ships the four expected locales", () => {
    expect(Object.keys(LOCALES).sort()).toEqual(["en", "es", "ja", "ko"]);
  });
});

describe("locale key parity", () => {
  it.each(otherLocales)("%s has no key that English lacks", (lang) => {
    const orphans = [...keysOf[lang]].filter((key) => !keysOf[REFERENCE].has(key)).sort();
    expect(orphans).toEqual([]);
  });

  it.each(otherLocales)("%s covers every English key except its known gaps", (lang) => {
    const missing = [...keysOf[REFERENCE]].filter((key) => !keysOf[lang].has(key)).sort();
    expect(missing).toEqual([...KNOWN_GAPS[lang]].sort());
  });

  it.each(otherLocales)("%s has no stale entries in its known-gap list", (lang) => {
    // A gap entry that the locale now translates, or that no longer exists in
    // English at all, must be deleted from the list above.
    const stale = KNOWN_GAPS[lang]
      .filter((key) => keysOf[lang].has(key) || !keysOf[REFERENCE].has(key))
      .sort();
    expect(stale).toEqual([]);
  });

  it("keeps every locale free of empty translations", () => {
    for (const [lang, dict] of Object.entries(LOCALES)) {
      for (const key of leafKeys(dict)) {
        const value = key.split(".").reduce((acc, part) => acc[part], dict);
        expect(typeof value, `${lang}.${key} should be a string`).toBe("string");
        expect(value.trim().length, `${lang}.${key} should not be empty`).toBeGreaterThan(0);
      }
    }
  });
});

describe("purged feature keys stay purged", () => {
  // The desktop-era features these described are gone from the product. If one
  // of these prefixes reappears, either a revert went wrong or a new feature
  // picked a confusingly reused name.
  const REMOVED_PREFIXES = [
    "settings.tunnel.", // guest device tunnel for VTube Studio lip-sync
    "settings.reddit.", // Reddit story reader
    "settings.youtube.", // YouTube peek (NOT the !sr song queue, which lives on)
    "settings.trivia.", // on-screen question watcher, auto-click, auto-navigate
    "settings.vtube.", // VTube Studio lip-sync
    "app.screenWatch.", // status-footer strings for the screen watcher
  ];

  it.each(Object.keys(LOCALES))("%s has no keys for deleted features", (lang) => {
    const survivors = [...keysOf[lang]]
      .filter((key) => REMOVED_PREFIXES.some((prefix) => key.startsWith(prefix)))
      .sort();
    expect(survivors).toEqual([]);
  });

  it.each(Object.keys(LOCALES))("%s has no ElevenLabs strings left", (lang) => {
    const survivors = [...keysOf[lang]].filter((key) => /eleven/i.test(key)).sort();
    expect(survivors).toEqual([]);
  });

  it("keeps the song request queue, which is not part of the YouTube purge", () => {
    // `!sr` outlives the YouTube peek feature; both mention YouTube, only one died.
    for (const lang of Object.keys(LOCALES)) {
      expect(keysOf[lang].has("videoQueue.viewerRequests")).toBe(true);
      expect(keysOf[lang].has("videoQueue.footerHint")).toBe(true);
    }
  });
});
