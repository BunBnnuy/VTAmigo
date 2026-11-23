// Deck validation is the last gate between model stdout and the live stream:
// it drops bad kinds, markup/URLs, absurd lengths and repeats before anything
// can be spoken. These tests are pure — no CLI, no provider.
import { describe, expect, it } from "vitest";

const { parseDeck, similarity, normalizeText, markUsed, listDecks, recentHistory } = require("../showScript");
const { db } = require("../db");

const beat = (over = {}) => ({
  kind: "topic",
  text: "Hoy venimos con ganas de probar el parche nuevo y ver qué tal se siente.",
  afterMin: 0,
  beforeMin: 0,
  ...over,
});

describe("parseDeck", () => {
  it("parses a JSON array, assigns ids and clamps timing", () => {
    const beats = parseDeck(
      JSON.stringify([
        beat({ afterMin: -5, beforeMin: 200 }),
        beat({ kind: "bridge", text: "Cambiamos de canción, que esta ya ha sonado bastante.", afterMin: 12, beforeMin: 4 }),
      ])
    );
    expect(beats).toHaveLength(2);
    expect(beats[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(beats[0].afterMin).toBe(0);
    expect(beats[0].beforeMin).toBe(90);
    // beforeMin must be after afterMin, never a window that can't happen.
    expect(beats[1].beforeMin).toBeGreaterThan(beats[1].afterMin);
  });

  it("accepts fenced JSON and ignores prose around it", () => {
    const beats = parseDeck(
      "Aquí tienes el guion:\n```json\n" +
        JSON.stringify([beat(), beat({ text: "Otra frase distinta para el segundo beat del deck." })]) +
        "\n```\nEspero que sirva."
    );
    expect(beats).toHaveLength(2);
  });

  it("drops invalid kinds, markup, URLs and out-of-range lengths", () => {
    const beats = parseDeck(
      JSON.stringify([
        beat({ kind: "advertisement" }),
        beat({ text: "Mira esto en https://example.com para verlo mejor." }),
        beat({ text: "Esto lleva **markdown** y no se puede leer en voz alta." }),
        beat({ text: "corto" }),
        beat({ text: "x".repeat(241) }),
        beat({ text: "Una frase válida que sí debería sobrevivir al filtro." }),
      ])
    );
    expect(beats).toHaveLength(1);
    expect(beats[0].text).toContain("válida");
  });

  it("drops duplicates inside the deck and against recent history", () => {
    const repeated = "Hoy venimos con ganas de probar el parche nuevo y ver qué tal se siente.";
    const beats = parseDeck(
      JSON.stringify([
        beat({ text: repeated }),
        beat({ text: repeated.toUpperCase() }),
        beat({ text: "Una frase completamente distinta sobre la música de fondo." }),
      ]),
      { avoid: ["Hoy venimos con ganas de probar el parche nuevo y ver qué tal se siente."] }
    );
    // The repeated line is in avoid, so only the distinct one survives.
    expect(beats).toHaveLength(1);
    expect(beats[0].text).toContain("música");
  });

  it("caps a runaway deck at 20 beats", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      beat({ text: `Beat número ${i} con una frase suficientemente larga para pasar el filtro.` })
    );
    expect(parseDeck(JSON.stringify(many))).toHaveLength(20);
  });

  it("throws SCRIPT_BAD_JSON on unparseable output", () => {
    expect(() => parseDeck("no soy json")).toThrow("SCRIPT_BAD_JSON");
    expect(() => parseDeck("[{ roto")).toThrow("SCRIPT_BAD_JSON");
  });
});

describe("markUsed", () => {
  const TWITCH_ID = "show-script-unit-user";
  const DECK_ID = "show-script-unit-deck";
  const TEXT = "Una frase única sobre el parche nuevo que acabamos de probar en directo.";

  it("marks the beat, records history and is idempotent", () => {
    db.prepare(`DELETE FROM show_scripts WHERE id = ?`).run(DECK_ID);
    db.prepare(`DELETE FROM show_script_history WHERE twitchId = ?`).run(TWITCH_ID);
    db.prepare(
      `INSERT INTO show_scripts (id, twitchId, createdAt, beats, meta) VALUES (?, ?, ?, ?, ?)`
    ).run(
      DECK_ID,
      TWITCH_ID,
      Date.now(),
      JSON.stringify([{ id: "b1", kind: "topic", text: TEXT, afterMin: 0, beforeMin: 0 }]),
      "{}"
    );

    expect(markUsed(TWITCH_ID, { deckId: DECK_ID, beatId: "b1" })).toBe(true);
    const [deck] = listDecks(TWITCH_ID);
    expect(deck.beats[0].usedAt).toBeTruthy();
    expect(recentHistory(TWITCH_ID, 5)).toContain(TEXT);
    // A repeated call must not throw or duplicate the history row.
    expect(markUsed(TWITCH_ID, { deckId: DECK_ID, beatId: "b1" })).toBe(false);

    db.prepare(`DELETE FROM show_scripts WHERE id = ?`).run(DECK_ID);
    db.prepare(`DELETE FROM show_script_history WHERE twitchId = ?`).run(TWITCH_ID);
  });
});

describe("similarity", () => {  it("normalizes accents and punctuation", () => {
    expect(normalizeText("¡Hola,  qué tal!")).toBe("hola que tal");
  });

  it("scores paraphrases above unrelated lines", () => {
    const a = "Hoy vamos a probar el parche nuevo del juego y comentar qué tal.";
    const b = "Hoy vamos a probar el parche nuevo del juego y ver qué tal.";
    const c = "Cambiamos de canción, que esta ya ha sonado bastante.";
    expect(similarity(a, b)).toBeGreaterThan(similarity(a, c));
  });
});
