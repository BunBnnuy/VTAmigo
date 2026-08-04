import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import Admin from "./Admin.jsx";
import Device from "./Device.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import { initErrorLogger } from "./errorLogger.js";
import "./index.css";

initErrorLogger();

const path = window.location.pathname;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      {path.startsWith("/admin") ? <Admin /> : path.startsWith("/device") ? <Device /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);
