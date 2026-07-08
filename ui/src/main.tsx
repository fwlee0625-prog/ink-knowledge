import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ClipboardWindow } from "./components/features/clipboard/ClipboardWindow";
import { OcrResultWindow } from "./components/features/ocr-result-window/OcrResultWindow";
import { TranslationWindow } from "./components/features/translate/TranslationWindow";
import { MessageProvider } from "./components/ui";
import "./styles.scss";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("App root is missing.");
}

const appView = window.location.hash === "#/settings" ? "settings" : "ocr";

createRoot(root).render(
  <StrictMode>
    <MessageProvider>
      {window.location.hash === "#/ocr-result" ? (
        <OcrResultWindow />
      ) : window.location.hash === "#/translation" ? (
        <TranslationWindow />
      ) : window.location.hash === "#/clipboard" ? (
        <ClipboardWindow />
      ) : (
        <App initialView={appView} />
      )}
    </MessageProvider>
  </StrictMode>,
);
