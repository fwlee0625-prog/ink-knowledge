import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { OcrResultWindow } from "./components/features/ocr-result-window/OcrResultWindow";
import { MessageProvider } from "./components/ui";
import "./styles.scss";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("App root is missing.");
}

createRoot(root).render(
  <StrictMode>
    <MessageProvider>
      {window.location.hash === "#/ocr-result" ? <OcrResultWindow /> : <App />}
    </MessageProvider>
  </StrictMode>,
);
