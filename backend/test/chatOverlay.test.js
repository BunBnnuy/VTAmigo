import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

const { app } = require("../app");
const schema = require("../chatOverlaySchema");

// The chat overlay is one hand-written static page (backend/overlay/chat.html)
// driven by backend/chatOverlaySchema.js. These assertions are about the
// markup and script text rather than rendered pixels — the regressions they
// guard ("a filter silently applies to some messages only", "an emote list
// never reaches the renderer") aren't observable from a request-level test.
let html = "";

beforeAll(async () => {
  const response = await request(app).get("/overlay/chat");
  expect(response.status).toBe(200);
  html = response.text;
});

describe("chat overlay page", () => {
  it("serves the feed container", () => {
    expect(html).toContain('id="feed"');
  });

  it("renders resolved emotes instead of setting raw text", () => {
    // A message is only plain text if nothing in it resolved to an emote;
    // buildContent is what turns the codepoint-indexed emote list into images.
    expect(html).toContain("buildContent(text, emoteList, big, caps)");
    expect(html).toMatch(/emotes/);
  });

  it("applies the command/mute filters before rendering", () => {
    const body = html.slice(html.indexOf("function handleChatMessage"));
    const mute = body.indexOf("isMuted(msg)");
    const command = body.indexOf("isCommand(msg.text)");
    const render = body.indexOf("renderMessage(");
    expect(mute).toBeGreaterThan(-1);
    expect(command).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(-1);
    expect(mute).toBeLessThan(render);
    expect(command).toBeLessThan(render);
  });

  it("marks /me messages as actions", () => {
    expect(html).toContain(".cg-msg.action .cg-text");
    expect(html).toMatch(/msg\.isAction/);
  });

  it("resolves the streamer/mod/vip/sub role from badges", () => {
    expect(html).toMatch(/b\.type === "broadcaster"/);
    expect(html).toMatch(/b\.type === "moderator"/);
    expect(html).toMatch(/b\.type === "vip"/);
    expect(html).toMatch(/subscriber|founder/);
  });
});

describe("chat overlay schema", () => {
  it("exposes a field definition for every default", () => {
    for (const field of schema.FIELDS) {
      expect(schema.DEFAULTS).toHaveProperty(field.key, field.default);
    }
  });

  it("has unique keys", () => {
    const keys = schema.FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("sanitizes values by type and drops unknown keys", () => {
    const out = schema.sanitize({
      width: 99999, // clamped to max
      animate: "yes", // coerced to boolean
      nameColor: "not-a-color", // falls back to default
      role_streamer_tag: "OWNER",
      bogus_key: "nope",
    });
    expect(out.width).toBe(1200);
    expect(out.animate).toBe(true);
    expect(out.nameColor).toBe(schema.DEFAULTS.nameColor);
    expect(out.role_streamer_tag).toBe("OWNER");
    expect(out).not.toHaveProperty("bogus_key");
  });
});
