import React from "react";
import { describe, expect, it, vi, beforeAll } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../src/api.js", () => {
  const LAYERS = [
    { id: "l1", type: "text", text: "Hello {follower.username}", fontSize: 48, color: "#fff", bold: false, align: "left", x: 100, y: 100, w: 500, h: 100 },
    { id: "l2", type: "image", assetId: "a1", x: -600, y: 0, w: 480, h: 320 },
    { id: "l3", type: "overlay", sourceId: "s1", x: 0, y: 0, w: 800, h: 600 },
  ];
  const ASSETS = [{ id: "a1", kind: "image", sizeBytes: 2048, mime: "image/png", name: "Backdrop" }];
  const ok = (body) => ({ ok: true, json: async () => body });

  return {
    apiFetch: vi.fn(async (url) => {
      if (url === "/overlay-builder/layouts/layout-1") return ok({ layout: { layers: LAYERS } });
      if (url === "/overlay-builder/assets") return ok({ assets: ASSETS, usageBytes: 0, quotaBytes: 104857600 });
      if (url === "/overlay-builder/sources") return ok({ sources: [{ id: "s1", name: "Chat overlay", path: "/overlay/chat", w: 800, h: 600 }] });
      if (url === "/overlay-builder/overlay-url/layout-1") return ok({ token: "tok" });
      if (String(url).startsWith("/overlay-builder/assets/")) return ok({ ok: true });
      return ok({});
    }),
    apiUrl: (p) => p,
  };
});

vi.mock("react-rnd", () => ({
  Rnd: ({ children, onMouseDown }) => <div onMouseDown={onMouseDown}>{children}</div>,
}));

import { apiFetch } from "../src/api.js";
import OverlayCanvas from "../src/OverlayCanvas.jsx";

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const layerRows = () => [...document.querySelectorAll("[data-layer-id]")];
const layerIds = () => layerRows().map((r) => r.getAttribute("data-layer-id"));

async function renderEditor() {
  render(<OverlayCanvas layoutId="layout-1" latestByKind={{}} />);
  await waitFor(() => expect(screen.getAllByText("Chat overlay").length).toBeGreaterThan(0));
}

describe("OverlayCanvas layers sidebar", () => {
  it("lists layers topmost first, flags off-canvas layers and selects from the list", async () => {
    await renderEditor();

    expect(layerIds()).toEqual(["l3", "l2", "l1"]);
    // Image layer is fully off-canvas -> flagged.
    expect(layerRows()[1].querySelector("[title='Fully outside the canvas']")).not.toBeNull();

    await userEvent.click(layerRows()[2].querySelector("[data-layer-select]"));
    expect(screen.getByText("Properties — text")).toBeInTheDocument();

    // Zoom controls: + steps up from the 5% fallback fit scale (jsdom has no
    // layout, so the fit computation clamps to the 0.05 floor), and clicking
    // the percentage resets back to fit.
    const zoomPct = () => screen.getByTitle("Reset zoom to fit").textContent;
    expect(zoomPct()).toBe("5%");
    await userEvent.click(screen.getByTitle("Zoom in"));
    expect(zoomPct()).toBe("6%");
    await userEvent.click(screen.getByTitle("Reset zoom to fit"));
    expect(zoomPct()).toBe("5%");
  });

  it("reorders layers with drag and drop", async () => {
    await renderEditor();
    expect(layerIds()).toEqual(["l3", "l2", "l1"]);

    const dataTransfer = { effectAllowed: "", dropEffect: "", setData: vi.fn() };
    const dropRect = (top) => ({ top, height: 40 });
    // jsdom doesn't fill clientY on drag events (the component treats a
    // missing value as 0), so the mocked rect decides before vs after.

    // Drag the bottom-most layer (l1) above l2 -> [l3, l1, l2].
    vi.spyOn(layerRows()[1], "getBoundingClientRect").mockReturnValue(dropRect(100));
    fireEvent.dragStart(layerRows()[2], { dataTransfer });
    fireEvent.drop(layerRows()[1], { dataTransfer });
    await waitFor(() => expect(layerIds()).toEqual(["l3", "l1", "l2"]));

    // Drag the top layer (l3) below l1 -> [l1, l3, l2].
    vi.spyOn(layerRows()[1], "getBoundingClientRect").mockReturnValue(dropRect(-100));
    fireEvent.dragStart(layerRows()[0], { dataTransfer });
    fireEvent.drop(layerRows()[1], { dataTransfer });
    await waitFor(() => expect(layerIds()).toEqual(["l1", "l3", "l2"]));
  });

  it("renames a layer inline", async () => {
    await renderEditor();
    const row = layerRows().find((r) => r.getAttribute("data-layer-id") === "l1");

    await userEvent.dblClick(row.querySelector("[data-layer-select]"));
    const input = document.querySelector("[data-layer-rename]");
    expect(input).not.toBeNull();

    await userEvent.clear(input);
    await userEvent.type(input, "Announcement");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(within(row).getByText("Announcement")).toBeInTheDocument());
    // The Properties panel field reflects the same name.
    expect(screen.getByDisplayValue("Announcement")).toBeInTheDocument();
  });

  it("opens the media library modal and renames/deletes an asset", async () => {
    await renderEditor();
    expect(screen.queryByText("Media Library")).toBeNull();

    await userEvent.click(screen.getByTitle("Media library"));
    expect(screen.getByText("Media Library")).toBeInTheDocument();

    const nameInput = screen.getByDisplayValue("Backdrop");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Background art");
    await userEvent.keyboard("{Enter}");

    expect(apiFetch).toHaveBeenCalledWith(
      "/overlay-builder/assets/a1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Background art" }) })
    );

    await userEvent.click(screen.getByTitle("Delete asset"));
    await userEvent.click(screen.getByTitle("Click again to confirm"));
    expect(apiFetch).toHaveBeenCalledWith("/overlay-builder/assets/a1", { method: "DELETE" });

    await userEvent.click(screen.getByTitle("Close"));
    expect(screen.queryByText("Media Library")).toBeNull();
  });
});
