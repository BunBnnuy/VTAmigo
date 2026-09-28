// The Live Chat panel renders each message's text with its resolved emotes
// spliced in as images (backend/emotes.js provides `emotes` with inclusive
// code point indices). This pins both the basic case and the code-point
// indexing, where a naive string slice would misplace an emote that follows
// an astral character (most emoji).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import ChatFeed from "../src/ChatFeed.jsx";

// jsdom does not implement scrollIntoView, which ChatFeed calls on every new
// message; the panel's own auto-scroll test stubs it the same way.
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const url = "https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_abc/default/dark/2.0";

function msg(text, emotes) {
  return { id: "1", timestamp: Date.now(), username: "KillBnnuy", color: "#e11d76", text, emotes };
}

describe("ChatFeed emote rendering", () => {
  it("renders a resolved emote as an image, not text", () => {
    const { container, getByTitle } = render(
      createElement(ChatFeed, { messages: [msg("hello killbnQlazo", [{ name: "killbnQlazo", urls: { 1: url, 2: url, 4: url }, start: 6, end: 16 }])], lang: "en" })
    );
    expect(getByTitle("killbnQlazo")).toBeTruthy();
    expect(container.querySelector("img").getAttribute("src")).toBe(url);
    expect(container.textContent).toContain("hello");
    expect(container.textContent).not.toContain("killbnQlazo");
  });

  it("keeps emote positions correct after an astral character", () => {
    // "😀 Kappa": Array.from -> [😀, ' ', K, a, p, p, a], so Kappa is 2..6.
    const { container } = render(
      createElement(ChatFeed, { messages: [msg("😀 Kappa", [{ name: "Kappa", urls: { 1: url, 2: url, 4: url }, start: 2, end: 6 }])], lang: "en" })
    );
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(container.textContent).toContain("😀");
  });

  it("leaves plain text untouched when there are no emotes", () => {
    const { container } = render(
      createElement(ChatFeed, { messages: [msg("just words", [])], lang: "en" })
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("just words");
  });
});
