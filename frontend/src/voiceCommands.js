// Lightweight phrase matcher for mic "commands"/"full" mode — looks for a
// spoken request to change the live Twitch stream's title or category in a
// final speech transcript. Matches English and Spanish (the mic language
// options exposed in Settings) since Web Speech API transcripts come back
// in whatever language recognition was set to.
//
// Patterns are matched against a lowercased copy of the transcript so the
// captured value can still be sliced out of the ORIGINAL text — this keeps
// the streamer's actual casing/accents (e.g. a title like "Súper Mario")
// instead of losing them to lowercasing.
const TITLE_PATTERNS = [
  /\b(?:change|set|update)\s+(?:the\s+)?(?:stream\s+)?title\s+to\s+(.+)/,
  /\bcambia(?:r)?\s+(?:el\s+)?t[ií]tulo(?:\s+del\s+stream)?\s+a\s+(.+)/,
  /\bpon(?:le|er)?\s+(?:el\s+)?t[ií]tulo(?:\s+del\s+stream)?\s+(?:a|en)\s+(.+)/,
];

const CATEGORY_PATTERNS = [
  /\b(?:change|set|update)\s+(?:the\s+)?(?:stream\s+)?(?:category|game)\s+to\s+(.+)/,
  /\bcambia(?:r)?\s+(?:la\s+)?(?:categor[ií]a|juego)(?:\s+del\s+stream)?\s+a\s+(.+)/,
  /\bpon(?:le|er)?\s+(?:la\s+)?(?:categor[ií]a|juego)(?:\s+del\s+stream)?\s+(?:a|en)\s+(.+)/,
];

function cleanValue(v) {
  return v.trim().replace(/[.!?¡¿,;:]+$/g, "").trim();
}

function firstMatch(patterns, lowerText) {
  for (const re of patterns) {
    const m = lowerText.match(re);
    if (m && m[1] && m[1].trim()) return m;
  }
  return null;
}

// Keep the configured separator and its suffix, but leave a space between the
// newly spoken title and the first separator character.
export function mergeTitleWithDelimiter(title, currentTitle, delimiter) {
  if (!delimiter) return title;
  const idx = (currentTitle || "").indexOf(delimiter);
  return idx === -1 ? title : `${title} ${currentTitle.slice(idx)}`;
}

// Returns { type: "title" | "category", value } or null.
export function parseVoiceCommand(rawText) {
  const text = (rawText || "").trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  const titleMatch = firstMatch(TITLE_PATTERNS, lower);
  if (titleMatch) {
    const start = titleMatch.index + titleMatch[0].length - titleMatch[1].length;
    const value = cleanValue(text.slice(start));
    if (value) return { type: "title", value };
  }

  const categoryMatch = firstMatch(CATEGORY_PATTERNS, lower);
  if (categoryMatch) {
    const start = categoryMatch.index + categoryMatch[0].length - categoryMatch[1].length;
    const value = cleanValue(text.slice(start));
    if (value) return { type: "category", value };
  }

  return null;
}
