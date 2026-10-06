import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installPerfTools } from "./lib/perf";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/overlays.css";
import "./styles/feedback.css";
import "./styles/v7-shell.css";
import "./styles/v7-gallery.css";
import "./styles/v7-settings-trash.css";
import "./styles/v7-trash.css";
import "./styles/v7-preview.css";
import "./styles/v7-modal.css";
import "./styles/v7-theme.css";

installPerfTools();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
