import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import Admin from "./Admin.jsx";
import Device from "./Device.jsx";
import "./index.css";

const path = window.location.pathname;

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {path.startsWith("/admin") ? <Admin /> : path.startsWith("/device") ? <Device /> : <App />}
  </React.StrictMode>
);
