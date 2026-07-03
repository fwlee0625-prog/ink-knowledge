import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "virtual:uno.css";
import "./styles.scss";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("App root is missing.");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
