// The announcement modal has exactly one job: show up once per release and
// then stay out of the way. Both halves are worth pinning — a modal that
// reappears on every launch is as broken as one that never shows.
import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENTS,
  CURRENT_ANNOUNCEMENT,
  SEEN_STORAGE_KEY,
  shouldShowAnnouncement,
  readSeenVersion,
  markAnnouncementSeen,
} from "../src/announcements.js";
import { LOCALES, translate } from "../src/i18n/index.js";

// Stands in for localStorage, including the throwing variety (private mode,
// storage disabled) that the real one turns into on some browsers.
function fakeStorage(initial = {}, { throws = false } = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => {
      if (throws) throw new Error("denied");
      return k in data ? data[k] : null;
    },
    setItem: (k, v) => {
      if (throws) throw new Error("denied");
      data[k] = String(v);
    },
    read: () => data,
  };
}

describe("shouldShowAnnouncement", () => {
  const announcement = { version: "v1", sections: [] };

  it("shows to someone who has never seen one", () => {
    expect(shouldShowAnnouncement({ seenVersion: null, isNewUser: false, announcement })).toBe(true);
  });

  it("shows again when a new release ships", () => {
    expect(shouldShowAnnouncement({ seenVersion: "v0", isNewUser: false, announcement })).toBe(true);
  });

  it("stays hidden once the same release was dismissed", () => {
    expect(shouldShowAnnouncement({ seenVersion: "v1", isNewUser: false, announcement })).toBe(false);
  });

  it("does not stack on top of the onboarding tour for a brand-new user", () => {
    expect(shouldShowAnnouncement({ seenVersion: null, isNewUser: true, announcement })).toBe(false);
  });

  it("is inert when there is nothing to announce", () => {
    expect(shouldShowAnnouncement({ seenVersion: null, isNewUser: false, announcement: null })).toBe(false);
  });
});

describe("seen-version storage", () => {
  it("round-trips the version", () => {
    const storage = fakeStorage();
    markAnnouncementSeen("v20260816", storage);
    expect(readSeenVersion(storage)).toBe("v20260816");
    expect(storage.read()[SEEN_STORAGE_KEY]).toBe("v20260816");
  });

  it("treats unreadable storage as never seen rather than throwing", () => {
    const storage = fakeStorage({}, { throws: true });
    expect(() => readSeenVersion(storage)).not.toThrow();
    expect(readSeenVersion(storage)).toBeNull();
  });

  it("does not throw when storage refuses the write", () => {
    const storage = fakeStorage({}, { throws: true });
    expect(() => markAnnouncementSeen("v1", storage)).not.toThrow();
  });
});

describe("release content", () => {
  it("has a current release with at least one section", () => {
    expect(CURRENT_ANNOUNCEMENT).toBeTruthy();
    expect(CURRENT_ANNOUNCEMENT.sections.length).toBeGreaterThan(0);
  });

  it("uses a distinct version per release, since that is the seen-key", () => {
    const versions = ANNOUNCEMENTS.map((a) => a.version);
    expect(new Set(versions).size).toBe(versions.length);
  });

  // The failure this system is most likely to hit: a release is added and one
  // locale is forgotten, so that language silently renders the raw key path.
  it("resolves every declared item in all four locales", () => {
    const missing = [];
    for (const announcement of ANNOUNCEMENTS) {
      for (const section of announcement.sections) {
        for (const item of section.items) {
          const key = `announcement.${announcement.version}.${section.kind}.${item}`;
          for (const lang of Object.keys(LOCALES)) {
            // translate() falls back to English and then to the key itself,
            // so "returns the key" is exactly the invisible-failure case.
            const value = translate(lang, key);
            if (value === key) missing.push(`${lang}: ${key}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("resolves the section headings and the OK button in all four locales", () => {
    const kinds = new Set(ANNOUNCEMENTS.flatMap((a) => a.sections.map((s) => s.kind)));
    for (const lang of Object.keys(LOCALES)) {
      expect(translate(lang, "announcement.title")).not.toBe("announcement.title");
      expect(translate(lang, "announcement.ok")).not.toBe("announcement.ok");
      for (const kind of kinds) {
        const key = `announcement.headings.${kind}`;
        expect(translate(lang, key)).not.toBe(key);
      }
    }
  });
});
