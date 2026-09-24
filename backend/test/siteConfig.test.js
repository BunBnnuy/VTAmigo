// Site-wide AI provider + model selection: the defaults, the per-provider
// model store, and the argv-shape validation (model ids end up in a spawn()
// argv array, so anything outside the real id charset must be rejected).
import { afterAll, describe, expect, it } from "vitest";

const siteConfig = require("../siteConfig");

const originalProvider = siteConfig.getProvider();
const originalOpenCodeModel = siteConfig.getModel("opencode");
const originalClaudeModel = siteConfig.getModel("claude");

afterAll(() => {
  siteConfig.setProvider(originalProvider);
  siteConfig.setModel("opencode", originalOpenCodeModel || "");
  siteConfig.setModel("claude", originalClaudeModel || "");
});

describe("site config AI provider + model", () => {
  it("defaults opencode to the cheap conversational Zen model", () => {
    siteConfig.setModel("opencode", "");
    expect(siteConfig.getModel("opencode")).toBe("opencode/claude-haiku-4-5");
  });

  it("stores a per-provider model and validates its shape", () => {
    siteConfig.setProvider("opencode");
    siteConfig.setModel("opencode", "opencode/glm-5.3-flash");
    expect(siteConfig.getModel("opencode")).toBe("opencode/glm-5.3-flash");
    expect(siteConfig.getModel()).toBe("opencode/glm-5.3-flash");

    expect(() => siteConfig.setModel("opencode", "bad model; rm -rf")).toThrow("Invalid model");
    expect(() => siteConfig.setModel("opencode", "x".repeat(121))).toThrow("Invalid model");
    expect(() => siteConfig.setModel("nope", "opencode/x")).toThrow("Invalid provider");
    expect(() => siteConfig.setProvider("chatgpt")).toThrow("Invalid provider");
  });

  it("claude has no default model but keeps an explicit one", () => {
    expect(siteConfig.getModel("claude")).toBeNull();
    siteConfig.setModel("claude", "claude-haiku-4-5");
    expect(siteConfig.getModel("claude")).toBe("claude-haiku-4-5");
    siteConfig.setModel("claude", "");
    expect(siteConfig.getModel("claude")).toBeNull();
  });
});
