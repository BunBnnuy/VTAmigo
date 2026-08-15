// Release announcements — the modal a user sees once after an update ships.
//
// Each entry is the human-written summary of what changed between master and
// dev for that release. The diff between the two branches is what tells you
// *what* to write; it is deliberately not what gets rendered, because a list
// of commit subjects ("Harden the auth trust root: per-purpose keys") is not
// something a streamer can act on.
//
// Adding a release:
//   1. prepend an entry here with a new `version`
//   2. add `announcement.<version>.<kind>.<item>` to ALL FOUR locales —
//      frontend/test/i18nParity.test.js fails on a locale left behind
// The stored "seen" value is the version string, so bumping it is what makes
// the modal reappear exactly once.

export const SEEN_STORAGE_KEY = "announcement_seen";

// `kind` picks the section heading (announcement.headings.<kind>) and its
// accent; `items` are i18n key suffixes, rendered in order.
export const ANNOUNCEMENTS = [
  {
    version: "v20260816",
    sections: [
      { kind: "action", items: ["overlays"] },
      {
        kind: "fixed",
        items: ["songRequestPanel", "botIgnoresSongRequests", "noScrollJump", "chatReconnect", "aiWedge"],
      },
      // `ttsVoices` rather than an ElevenLabs-shaped name on purpose: the
      // i18n purge suite fails any locale key matching /eleven/i, to catch a
      // retired feature creeping back. Naming the retirement is fine, the copy
      // still says it — reusing the feature's own key name is not.
      { kind: "removed", items: ["vtubeStudio", "desktopApp", "disabledFeatures", "ttsVoices"] },
    ],
  },
];

export const CURRENT_ANNOUNCEMENT = ANNOUNCEMENTS[0] || null;

// Someone who has never used VTAmigo gets the onboarding tour instead: a
// changelog is meaningless when there is no "before", and stacking a modal on
// top of the tour is just two things to dismiss. They still get marked as
// having seen it, so the next release is their first real announcement.
export function shouldShowAnnouncement({ seenVersion, isNewUser, announcement = CURRENT_ANNOUNCEMENT }) {
  if (!announcement) return false;
  if (isNewUser) return false;
  return seenVersion !== announcement.version;
}

export function readSeenVersion(storage) {
  try {
    return (storage || window.localStorage).getItem(SEEN_STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: treat as "never seen". The modal
    // reappearing is a better failure than it never showing at all.
    return null;
  }
}

export function markAnnouncementSeen(version, storage) {
  try {
    (storage || window.localStorage).setItem(SEEN_STORAGE_KEY, version);
  } catch {
    // Nothing to do — it will show again next launch.
  }
}
