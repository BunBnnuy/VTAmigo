// Spoken stream controls: the mic's "commands"/"full" modes run every final
// transcript through parseVoiceCommand, so a false positive here retitles a
// live stream. These cases pin down both what counts as a command and what
// deliberately does not.
import { describe, expect, it } from "vitest";
import { parseVoiceCommand } from "../src/voiceCommands.js";

describe("title commands", () => {
  it("recognises the English phrasings", () => {
    expect(parseVoiceCommand("change the title to Speedrun night")).toEqual({
      type: "title",
      value: "Speedrun night",
    });
    expect(parseVoiceCommand("set stream title to Chill chat")).toEqual({
      type: "title",
      value: "Chill chat",
    });
    expect(parseVoiceCommand("update the title to Part 3")).toEqual({
      type: "title",
      value: "Part 3",
    });
  });

  it("recognises the Spanish phrasings", () => {
    expect(parseVoiceCommand("cambia el título a Noche de sustos")).toEqual({
      type: "title",
      value: "Noche de sustos",
    });
    expect(parseVoiceCommand("ponle el titulo del stream a Ruleta")).toEqual({
      type: "title",
      value: "Ruleta",
    });
  });

  it("keeps the spoken casing and accents of the title", () => {
    // The matcher lowercases a copy to find the phrase, then slices the value
    // out of the original — losing "Súper" to "súper" would be a regression.
    expect(parseVoiceCommand("change the title to Súper Mario Maker")).toEqual({
      type: "title",
      value: "Súper Mario Maker",
    });
  });

  it("strips trailing sentence punctuation from the value", () => {
    expect(parseVoiceCommand("cambia el título a Maratón de terror!")).toEqual({
      type: "title",
      value: "Maratón de terror",
    });
  });

  it("captures a delimiter and everything after it verbatim", () => {
    // App.jsx splices the streamer's micTitleDelimiter (e.g. "|") out of the
    // live title and keeps the tail, so the parser must hand over the spoken
    // text whole — including the delimiter — rather than cutting at it.
    expect(parseVoiceCommand("change the title to Day 4 | !discord !socials")).toEqual({
      type: "title",
      value: "Day 4 | !discord !socials",
    });
  });

  it("ignores a command with nothing after the phrase", () => {
    expect(parseVoiceCommand("change the title to ")).toBeNull();
  });
});

describe("category commands", () => {
  it("recognises category and game wording in both languages", () => {
    expect(parseVoiceCommand("change the category to Just Chatting")).toEqual({
      type: "category",
      value: "Just Chatting",
    });
    expect(parseVoiceCommand("set the game to Hollow Knight")).toEqual({
      type: "category",
      value: "Hollow Knight",
    });
    expect(parseVoiceCommand("cambia la categoría a Solo Chateando")).toEqual({
      type: "category",
      value: "Solo Chateando",
    });
    expect(parseVoiceCommand("ponle la categoria a Minecraft")).toEqual({
      type: "category",
      value: "Minecraft",
    });
  });

  it("does not yet understand the masculine article before 'juego'", () => {
    // Documented gap, not a wish: the Spanish patterns only allow "la" before
    // categoría/juego, so "pon el juego a X" falls through. Kept as a test so
    // widening the pattern later is a deliberate, visible change.
    expect(parseVoiceCommand("pon el juego a Minecraft")).toBeNull();
  });

  it("prefers a title command when a sentence could match either", () => {
    expect(parseVoiceCommand("change the title to Category hunting")).toEqual({
      type: "title",
      value: "Category hunting",
    });
  });
});

describe("everything that is not a command", () => {
  it.each([
    "",
    "   ",
    "hey chat, what do you think of the new title?",
    "I might change the category later",
    "the title to this song is really good",
    "cambia de tema, esto ya aburre",
  ])("returns null for %j", (text) => {
    expect(parseVoiceCommand(text)).toBeNull();
  });

  it("returns null for missing input", () => {
    expect(parseVoiceCommand(undefined)).toBeNull();
    expect(parseVoiceCommand(null)).toBeNull();
  });
});
