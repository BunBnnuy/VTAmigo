import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "../index.css";
import "./vrmLab.css";
import VRMLab from "./VRMLab.jsx";

// Standalone page (not routed through main.jsx) so the prototype ships as a
// separate entry chunk: three + three-vrm never land in the main app bundle.
// No StrictMode here: its dev-only double-mount would build (and dispose) two
// WebGL contexts and two model loads for every visit.

// The VRM lab is an owner-only surface. The backend already 404s its config
// and viseme routes for everyone else, so this gate is about not showing the
// UI at all — a normal account that guesses /vrm-lab.html gets a plain
// "not available" screen instead of a broken lab.
function OwnerGate() {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    fetch("/auth/me", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => setStatus(me?.loggedIn && me?.approved && me?.role === "owner" ? "ok" : "denied"))
      .catch(() => setStatus("denied"));
  }, []);

  if (status === "checking") return null;
  if (status === "denied") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: 24,
          textAlign: "center",
          background: "var(--bg)",
          color: "var(--text)",
        }}
      >
        <h1 style={{ margin: 0, fontFamily: "Quicksand, sans-serif", fontSize: 22 }}>VRM Lab</h1>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 14 }}>
          Esta sección solo está disponible para la cuenta owner.
        </p>
        <a href="/" style={{ color: "var(--accent)", fontSize: 13 }}>Volver a VTAmigo</a>
      </div>
    );
  }
  return <VRMLab />;
}

ReactDOM.createRoot(document.getElementById("root")).render(<OwnerGate />);
