// Preview-mode helpers for the app overlays, active only when a page is
// opened with ?preview=1 — a flag the Overlay Builder's canvas
// (frontend/src/OverlayCanvas.jsx) adds to its iframes. The OBS-facing output
// never carries it, so a live overlay stays fully transparent when idle.
//
// Each overlay renders a small mock of its real layout while it has no data
// yet, so the builder canvas reads as "this is what it will look like" rather
// than a blank box. This file just provides the shared bits: the corner
// "Preview" badge and the mock avatar/clip artwork the pages draw with.
(function () {
  const isPreview = new URLSearchParams(location.search).get("preview") === "1";
  if (!isPreview) return;

  function svgDataUrl(svg) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  // Generic avatar placeholder, drawn in the same frame the real image uses.
  function avatarDataUrl() {
    return svgDataUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">' +
        '<rect x="4" y="4" width="232" height="232" rx="24" fill="rgba(20,20,24,0.65)" stroke="rgba(255,255,255,0.35)" stroke-width="4" stroke-dasharray="10 8"/>' +
        '<circle cx="120" cy="96" r="40" fill="rgba(255,255,255,0.55)"/>' +
        '<path d="M50 208c0-40 32-64 70-64s70 24 70 64z" fill="rgba(255,255,255,0.55)"/>' +
      "</svg>"
    );
  }

  // Mock video/clip frame: dark stage, play glyph and a caption.
  function posterDataUrl(label) {
    const text = String(label || "Sample");
    return svgDataUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">' +
        '<rect width="640" height="360" fill="#0d0d10"/>' +
        '<rect x="8" y="8" width="624" height="344" rx="12" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="3" stroke-dasharray="12 10"/>' +
        '<circle cx="320" cy="158" r="48" fill="rgba(255,255,255,0.14)" stroke="rgba(255,255,255,0.6)" stroke-width="3"/>' +
        '<path d="M305 133l44 25-44 25z" fill="rgba(255,255,255,0.85)"/>' +
        '<text x="320" y="266" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="24" fill="rgba(255,255,255,0.75)">' +
          text +
        "</text>" +
      "</svg>"
    );
  }

  // Small corner pill so mock content is never mistaken for live data. Not a
  // screenshot-blocker — deliberately subtle.
  function badge() {
    if (!document.body || document.getElementById("overlay-preview-badge")) return;
    const el = document.createElement("div");
    el.id = "overlay-preview-badge";
    el.textContent = "Preview";
    el.style.cssText = [
      "position:fixed", "top:8px", "right:10px", "z-index:2147483647",
      "pointer-events:none", "font-family:'Segoe UI',system-ui,sans-serif",
      "font-size:11px", "font-weight:700", "letter-spacing:0.08em",
      "text-transform:uppercase", "color:#fff",
      "background:rgba(225,29,118,0.85)", "padding:3px 9px",
      "border-radius:999px", "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
    ].join(";");
    document.body.appendChild(el);
  }

  window.OverlayPreviewNote = { isPreview: true, badge, avatarDataUrl, posterDataUrl };
})();
