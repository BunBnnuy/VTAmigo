import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import Admin from "./Admin.jsx";
import Device from "./Device.jsx";
import OverlayBuilder from "./OverlayBuilder.jsx";
import NotFound from "./NotFound.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { initErrorLogger } from "./errorLogger.js";
import "./index.css";

initErrorLogger();

const path = window.location.pathname;

// The backend serves this SPA's index.html for any unmatched route (see
// backend/index.js's catch-all), so anything that isn't one of our known
// top-level paths lands here and should render NotFound rather than
// silently falling through to the main app/login screen.
function page() {
  if (path === "/") return <App />;
  if (path.startsWith("/admin")) return <Admin />;
  if (path.startsWith("/device")) return <Device />;
  if (path.startsWith("/overlay-builder")) return <OverlayBuilder />;
  return <NotFound />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>{page()}</ErrorBoundary>
  </React.StrictMode>
);
