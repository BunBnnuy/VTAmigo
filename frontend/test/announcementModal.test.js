// Rendering half of the announcement modal: it must actually show the release
// copy (not key paths), and "OK" must be the thing that closes it.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnnouncementModal from "../src/AnnouncementModal.jsx";
import { CURRENT_ANNOUNCEMENT } from "../src/announcements.js";
import es from "../src/i18n/locales/es.js";

// createElement rather than JSX: this file is plain .js, which esbuild does
// not run through the JSX transform.
function renderModal(props = {}) {
  return render(createElement(AnnouncementModal, {
    announcement: CURRENT_ANNOUNCEMENT,
    lang: "es",
    onClose: vi.fn(),
    ...props,
  }));
}

describe("AnnouncementModal", () => {
  it("renders as a modal dialog", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows the release copy rather than raw i18n keys", () => {
    renderModal();
    const copy = es.announcement[CURRENT_ANNOUNCEMENT.version];

    expect(screen.getByText(copy.action.overlays)).toBeInTheDocument();
    expect(screen.getByText(copy.fixed.botIgnoresSongRequests)).toBeInTheDocument();
    expect(screen.getByText(copy.removed.vtubeStudio)).toBeInTheDocument();
    // A missed key renders as "announcement.v…" — assert none leaked through.
    expect(screen.queryByText(/^announcement\./)).toBeNull();
  });

  it("shows a heading for every section of the release", () => {
    renderModal();
    for (const section of CURRENT_ANNOUNCEMENT.sections) {
      expect(screen.getByText(es.announcement.headings[section.kind])).toBeInTheDocument();
    }
  });

  it("closes on OK", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    await userEvent.click(screen.getByRole("button", { name: es.announcement.ok }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape, so it is never a trap", async () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to English copy for a locale it does not have", () => {
    // Not a real risk today (all four locales are complete, and
    // announcements.test.js pins that), but the modal must degrade to English
    // rather than to key paths if one ever drifts.
    renderModal({ lang: "pt" });
    expect(screen.queryByText(/^announcement\./)).toBeNull();
  });

  it("renders nothing when there is no announcement", () => {
    const { container } = renderModal({ announcement: null });
    expect(container).toBeEmptyDOMElement();
  });
});
