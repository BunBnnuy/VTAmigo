import { afterEach, describe, expect, it, vi } from "vitest";

const memoryDownload = require("../memoryDownload");

afterEach(() => {
  vi.clearAllMocks();
});

describe("memory download", () => {
  it("does not expose a cooldown after a previous download", async () => {
    let resolveFirst;
    const dumpMemory = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce("second memory");
    memoryDownload.startDownload("claude", "memory-download-test", dumpMemory);
    resolveFirst("first memory");
    await vi.waitFor(() => expect(memoryDownload.getStatus("memory-download-test").running).toBe(false));

    expect(memoryDownload.getStatus("memory-download-test")).not.toHaveProperty("availableAt");
    expect(() => memoryDownload.startDownload("claude", "memory-download-test", dumpMemory)).not.toThrow();
    await vi.waitFor(() => expect(memoryDownload.getStatus("memory-download-test").running).toBe(false));
    expect(dumpMemory).toHaveBeenCalledTimes(2);
  });

  it("still blocks concurrent downloads for the same account", () => {
    vi.useFakeTimers();
    try {
      const dumpMemory = vi.fn(() => new Promise(() => {}));
      memoryDownload.startDownload("claude", "memory-download-running-test", dumpMemory);
      expect(() => memoryDownload.startDownload("claude", "memory-download-running-test", dumpMemory)).toThrow("ALREADY_RUNNING");
    } finally {
      vi.useRealTimers();
    }
  });
});
