import React from "react";
import ReactDOM from "react-dom/client";
import "../index.css";
import "./vrmLab.css";
import VRMLab from "./VRMLab.jsx";

// Standalone page (not routed through main.jsx) so the prototype ships as a
// separate entry chunk: three + three-vrm never land in the main app bundle.
// No StrictMode here: its dev-only double-mount would build (and dispose) two
// WebGL contexts and two model loads for every visit.
ReactDOM.createRoot(document.getElementById("root")).render(<VRMLab />);
