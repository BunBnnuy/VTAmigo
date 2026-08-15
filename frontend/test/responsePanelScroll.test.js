// A new AI response auto-scrolls its list to the bottom. With the default
// "start" alignment that cascades up through every scrollable ancestor —
// including #root — so the whole app visibly jumped down each time the bot
// answered. ChatFeed already pins block: "nearest" for the same reason.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import ResponsePanel from "../src/ResponsePanel.jsx";
import ChatFeed from "../src/ChatFeed.jsx";

// createElement rather than JSX: this file is plain .js, which esbuild does
// not run through the JSX transform.
const response = (id) => ({ id, timestamp: Date.now(), text: `respuesta ${id}`, messageCount: 3 });

function renderPanel(responses) {
  return render(createElement(ResponsePanel, {
    responses,
    loading: false,
    onSendToChat: vi.fn(),
    botConnected: true,
    lang: "es",
  }));
}

describe("ResponsePanel auto-scroll", () => {
  it("scrolls within its own container instead of moving the page", () => {
    const scrollIntoView = vi.fn();
    // jsdom does not implement scrollIntoView at all, so it has to be provided
    // before render rather than spied on.
    Element.prototype.scrollIntoView = scrollIntoView;

    const { rerender } = renderPanel([response(1)]);
    rerender(createElement(ResponsePanel, {
      responses: [response(1), response(2)],
      loading: false,
      onSendToChat: vi.fn(),
      botConnected: true,
      lang: "es",
    }));

    expect(scrollIntoView).toHaveBeenCalled();
    for (const call of scrollIntoView.mock.calls) {
      expect(call[0]).toMatchObject({ block: "nearest" });
    }
  });

  it("still scrolls on a new response — the fix must not disable it", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    renderPanel([response(1)]);
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth", block: "nearest" })
    );
  });
});

describe("ChatFeed auto-scroll", () => {
  it("keeps the same containment, so the two panels can't drift apart", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(createElement(ChatFeed, {
      messages: [{ id: "m1", username: "viewer", text: "hola", timestamp: Date.now() }],
      lang: "es",
    }));

    for (const call of scrollIntoView.mock.calls) {
      expect(call[0]).toMatchObject({ block: "nearest" });
    }
  });
});
