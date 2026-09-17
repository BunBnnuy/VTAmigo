import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import ChatRankingPanel from "../src/ChatRankingPanel.jsx";

const ranking = [
  { username: "Luna", color: "#e11d76", xp: 240, level: 4 },
  { username: "Sol", color: "#9147ff", xp: 180, level: 3 },
  { username: "Nube", color: "#22c55e", xp: 130, level: 3 },
  { username: "Menta", color: "#ffb31a", xp: 90, level: 2 },
  { username: "Pixel", color: "#3b82f6", xp: 50, level: 2 },
  { username: "Extra", color: "#fff", xp: 1, level: 1 },
];

function mockApi() {
  const fetchMock = vi.fn((url) => {
    if (String(url).includes("ranking-overlay-url")) {
      return Promise.resolve({ ok: true, json: async () => ({ url: "https://example.test/overlay/xp-ranking?token=secret" }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ ranking }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ChatRankingPanel", () => {
  it("shows only the top five users and copies the dedicated overlay URL", async () => {
    mockApi();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    render(createElement(ChatRankingPanel));

    await waitFor(() => expect(screen.getByText("Luna")).toBeInTheDocument());
    expect(screen.getByText("Pixel")).toBeInTheDocument();
    expect(screen.queryByText("Extra")).toBeNull();

    const copyButton = screen.getByRole("button", { name: /copy overlay|copiar overlay/i });
    await waitFor(() => expect(copyButton).not.toBeDisabled());
    fireEvent.click(copyButton);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("https://example.test/overlay/xp-ranking?token=secret"));
    expect(screen.getByText(/overlay copied|overlay copiado/i)).toBeInTheDocument();
  });
});
