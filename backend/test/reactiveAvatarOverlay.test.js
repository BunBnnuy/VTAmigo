import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vtamigo-reactive-avatars-"));
process.env.REACTIVE_AVATARS_DIR = tempDir;

let reactiveAvatarOverlay;
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const gif = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

beforeAll(() => {
  reactiveAvatarOverlay = require("../reactiveAvatarOverlay");
});

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("reactiveAvatarOverlay", () => {
  it("stores speaking and silent images independently per account", () => {
    reactiveAvatarOverlay.saveImage("account-1", "speaking", png);
    reactiveAvatarOverlay.saveImage("account-1", "silent", gif);

    expect(reactiveAvatarOverlay.getStatus("account-1")).toEqual({ hasSpeaking: true, hasSilent: true });
    expect(reactiveAvatarOverlay.getImage("account-1", "speaking").mime).toBe("image/png");
    expect(reactiveAvatarOverlay.getImage("account-1", "silent").mime).toBe("image/gif");
    expect(reactiveAvatarOverlay.getImage("account-2", "speaking")).toBeNull();
  });

  it("replaces one slot without affecting the other", () => {
    reactiveAvatarOverlay.saveImage("account-2", "speaking", png);
    reactiveAvatarOverlay.saveImage("account-2", "silent", png);
    const silentPath = reactiveAvatarOverlay.getImage("account-2", "silent").filePath;

    reactiveAvatarOverlay.saveImage("account-2", "speaking", gif);

    expect(reactiveAvatarOverlay.getImage("account-2", "speaking").mime).toBe("image/gif");
    expect(reactiveAvatarOverlay.getImage("account-2", "silent").filePath).toBe(silentPath);
    expect(reactiveAvatarOverlay.getStatus("account-2")).toEqual({ hasSpeaking: true, hasSilent: true });
  });
});
