// AchievementsPanel renders backend state (GET /achievements/state) without
// fetching anything itself: groups, unlock styling, countable progress, and
// the tier-progress header.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import AchievementsPanel from "../src/AchievementsPanel.jsx";
import { DEFAULT_PANEL_LAYOUT, PANEL_META } from "../src/WindowManager.jsx";

// createElement rather than JSX: this file is plain .js, which esbuild does
// not run through the JSX transform.
const state = {
  achievements: [
    { id: "first_connect", category: "connection", points: 10, unlocked: true, target: 1, progress: 1 },
    { id: "ai_1", category: "ai", points: 10, unlocked: true, target: 1, progress: 1 },
    { id: "ai_20", category: "ai", points: 15, unlocked: false, target: 20, progress: 5 },
  ],
  totalPoints: 20,
  earnedTier: "free",
  tierThresholds: { free: 0, basic: 50, advanced: 150, pro: 300 },
};

function renderPanel(extra = {}) {
  return render(createElement(AchievementsPanel, { ...state, lang: "en", ...extra }));
}

describe("AchievementsPanel", () => {
  it("shows points, tier, and progress toward the next tier", () => {
    renderPanel();
    expect(screen.getByText("20 pts")).toBeInTheDocument();
    expect(screen.getByText("Tier: free")).toBeInTheDocument();
    expect(screen.getByText("basic tier: 20/50 pts")).toBeInTheDocument();
  });

  it("renders translated names and countable progress", () => {
    renderPanel();
    expect(screen.getByText("First connection")).toBeInTheDocument();
    expect(screen.getByText("Warming up")).toBeInTheDocument();
    expect(screen.getByText("5/20")).toBeInTheDocument();
  });

  it("declares the max tier instead of a next tier at the top", () => {
    renderPanel({ totalPoints: 370, earnedTier: "pro" });
    expect(screen.getByText("Max tier reached")).toBeInTheDocument();
  });

  it("shows a loading hint before the first fetch resolves", () => {
    render(createElement(AchievementsPanel, { lang: "en" }));
    expect(screen.getByText("Loading achievements…")).toBeInTheDocument();
  });
});

describe("achievements window registration", () => {
  it("has a default layout slot", () => {
    expect(DEFAULT_PANEL_LAYOUT.windows.achievements).toMatchObject({
      x: 1580,
      z: 10,
      collapsed: false,
      closed: false,
    });
  });

  it("is listed in the Panels menu metadata", () => {
    expect(PANEL_META.map((p) => p.id)).toContain("achievements");
  });
});
