// Pure helpers for the live show-script decks. Kept out of App.jsx so the
// playout rules (eligibility, FIFO across decks, question cooldown) can be
// tested without mounting the whole dashboard.
//
// A beat is eligible when it has not been spoken, its `afterMin` has passed
// (relative to the deck's creation), and its optional `beforeMin` has not.
// Decks are consumed oldest-first so the intended arc survives, but within a
// deck the playout picks among the first few beats at random.

export function eligibleForDeck(deck, now) {
  const ageMin = (now - deck.createdAt) / 60000;
  return (deck.beats || []).filter((beat) => {
    if (beat.usedAt) return false;
    if ((beat.afterMin || 0) > ageMin) return false;
    if (beat.beforeMin && ageMin > beat.beforeMin) return false;
    return true;
  });
}

export function unplayedBeats(decks, now = Date.now()) {
  const out = [];
  const ordered = [...(decks || [])].sort((a, b) => a.createdAt - b.createdAt);
  for (const deck of ordered) {
    for (const beat of eligibleForDeck(deck, now)) out.push({ ...beat, deckId: deck.id });
  }
  return out;
}

export function countUnplayed(decks, now = Date.now()) {
  return unplayedBeats(decks, now).length;
}

export function nextCandidates(decks, now = Date.now(), { perDeck = 3 } = {}) {
  const ordered = [...(decks || [])].sort((a, b) => a.createdAt - b.createdAt);
  for (const deck of ordered) {
    const beats = eligibleForDeck(deck, now);
    if (beats.length) return beats.slice(0, perDeck).map((beat) => ({ ...beat, deckId: deck.id }));
  }
  return [];
}

// `viewerCount` gates questions: asking an empty room is worse than silence.
// The question cooldown is a second guard on top of the prompt's own limits.
export function pickNextBeat(
  decks,
  now = Date.now(),
  { viewerCount = 0, lastQuestionAt = 0, questionCooldownMs = 10 * 60 * 1000 } = {}
) {
  const candidates = nextCandidates(decks, now);
  const questionAllowed = viewerCount >= 2 && now - lastQuestionAt > questionCooldownMs;
  const pool = candidates.filter((beat) => beat.kind !== "question" || questionAllowed);
  if (!pool.length) return null;
  const index = Math.floor(Math.random() * Math.min(3, pool.length));
  return pool[index];
}

export function markBeatUsed(decks, deckId, beatId, at = Date.now()) {
  return (decks || []).map((deck) =>
    deck.id !== deckId
      ? deck
      : {
          ...deck,
          beats: (deck.beats || []).map((beat) =>
            beat.id === beatId ? { ...beat, usedAt: at } : beat
          ),
        }
  );
}

export function previewBeats(decks, now = Date.now(), limit = 6) {
  return unplayedBeats(decks, now).slice(0, Math.max(0, limit));
}
