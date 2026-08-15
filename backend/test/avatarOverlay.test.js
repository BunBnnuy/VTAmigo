// Unit tests for backend/avatarOverlay.js — the on-disk store behind the
// avatar-swap overlay's speaking/silent images.
//
// It had no coverage at all: it was written as a stopgap for streamers who
// couldn't run VTube Studio, and it quietly became the only avatar mechanism
// the site has once VTS was purged. Its validation (mime allow-list, data-URL
// shape, 5MB cap) is what stands between a base64 request body and the
// filesystem, so it's worth pinning.
//
// AVATARS_DIR is pointed at a throwaway tmpdir here so the suite never writes
// into backend/data/avatars.
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vtamigo-avatars-"));
process.env.AVATARS_DIR = TMP_DIR;

let avatarOverlay;

// 1x1 transparent PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`;
const GIF_DATA_URL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

beforeAll(async () => {
  avatarOverlay = require("../avatarOverlay");
});

afterAll(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("avatarOverlay", () => {
  it("writes into the configured directory, not the real data dir", () => {
    avatarOverlay.saveImage("acct-dir", "speaking", PNG_DATA_URL);
    const image = avatarOverlay.getImage("acct-dir", "speaking");
    expect(image.filePath.startsWith(TMP_DIR)).toBe(true);
  });

  it("saveImage/getImage round-trips an image per account and slot", () => {
    avatarOverlay.saveImage("acct-1", "speaking", PNG_DATA_URL);
    avatarOverlay.saveImage("acct-1", "silent", GIF_DATA_URL);

    const speaking = avatarOverlay.getImage("acct-1", "speaking");
    expect(speaking.mime).toBe("image/png");
    expect(fs.readFileSync(speaking.filePath)).toEqual(Buffer.from(PNG_BASE64, "base64"));

    expect(avatarOverlay.getImage("acct-1", "silent").mime).toBe("image/gif");
  });

  it("keeps accounts separate", () => {
    avatarOverlay.saveImage("acct-2", "speaking", PNG_DATA_URL);
    expect(avatarOverlay.getImage("acct-2", "silent")).toBeNull();
    expect(avatarOverlay.getImage("acct-unknown", "speaking")).toBeNull();
  });

  it("replaces a slot and cleans up the old file when the extension changes", () => {
    avatarOverlay.saveImage("acct-3", "speaking", PNG_DATA_URL);
    const oldPath = avatarOverlay.getImage("acct-3", "speaking").filePath;

    avatarOverlay.saveImage("acct-3", "speaking", GIF_DATA_URL);
    const newImage = avatarOverlay.getImage("acct-3", "speaking");

    expect(newImage.mime).toBe("image/gif");
    expect(newImage.filePath).not.toBe(oldPath);
    expect(fs.existsSync(oldPath)).toBe(false);
  });

  it("getStatus reports which slots are filled", () => {
    expect(avatarOverlay.getStatus("acct-4")).toEqual({ hasSpeaking: false, hasSilent: false });
    avatarOverlay.saveImage("acct-4", "speaking", PNG_DATA_URL);
    expect(avatarOverlay.getStatus("acct-4")).toEqual({ hasSpeaking: true, hasSilent: false });
    avatarOverlay.saveImage("acct-4", "silent", PNG_DATA_URL);
    expect(avatarOverlay.getStatus("acct-4")).toEqual({ hasSpeaking: true, hasSilent: true });
  });

  it("getImage returns null when the manifest entry outlives the file", () => {
    avatarOverlay.saveImage("acct-5", "speaking", PNG_DATA_URL);
    fs.unlinkSync(avatarOverlay.getImage("acct-5", "speaking").filePath);
    expect(avatarOverlay.getImage("acct-5", "speaking")).toBeNull();
  });

  describe("rejections", () => {
    it("rejects an unknown slot", () => {
      expect(() => avatarOverlay.saveImage("acct-6", "mouth", PNG_DATA_URL)).toThrow("BAD_SLOT");
      expect(avatarOverlay.getImage("acct-6", "mouth")).toBeNull();
    });

    it("rejects an unsupported mime type", () => {
      expect(() =>
        avatarOverlay.saveImage("acct-6", "speaking", "data:image/svg+xml;base64,PHN2Zy8+")
      ).toThrow("UNSUPPORTED_TYPE");
      expect(() =>
        avatarOverlay.saveImage("acct-6", "speaking", "data:text/html;base64,PGgxPmhpPC9oMT4=")
      ).toThrow("UNSUPPORTED_TYPE");
    });

    it.each([
      ["empty", ""],
      ["undefined", undefined],
      ["a bare URL", "https://example.com/cat.png"],
      ["not base64-encoded", "data:image/png,raw-bytes-here"],
      ["missing the payload", "data:image/png;base64,"],
      ["missing the mime type", "data:;base64,QUJD"],
    ])("rejects a malformed data URL (%s)", (_label, value) => {
      expect(() => avatarOverlay.saveImage("acct-6", "speaking", value)).toThrow("BAD_DATA_URL");
    });

    it("rejects an image over the 5MB cap", () => {
      expect(avatarOverlay.MAX_BYTES).toBe(5 * 1024 * 1024);
      const oversized = Buffer.alloc(avatarOverlay.MAX_BYTES + 1, 0x41).toString("base64");
      expect(() =>
        avatarOverlay.saveImage("acct-7", "speaking", `data:image/png;base64,${oversized}`)
      ).toThrow("TOO_LARGE");
      // …and nothing was written for the rejected upload.
      expect(avatarOverlay.getStatus("acct-7")).toEqual({ hasSpeaking: false, hasSilent: false });
    });

    it("accepts an image right at the cap", () => {
      const atLimit = Buffer.alloc(avatarOverlay.MAX_BYTES, 0x41).toString("base64");
      expect(() =>
        avatarOverlay.saveImage("acct-8", "speaking", `data:image/webp;base64,${atLimit}`)
      ).not.toThrow();
      expect(avatarOverlay.getStatus("acct-8").hasSpeaking).toBe(true);
    });
  });
});
