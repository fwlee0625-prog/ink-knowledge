import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { PinIcon, TranslateIcon } from "../ocr-result-window/OcrResultIcons";
import { AppButton, useMessage } from "../../ui";
import { useFloatingWindowAutoClose } from "../floating-window/useFloatingWindowAutoClose";
import { fallbackSettings, normalizeSavedSettings, readLegacySavedSettings } from "../../../lib/settings";
import { resolveTranslationEngine } from "../../../lib/translation";
import type { AppSettings, TranslateResponse } from "../../../types";

type InlineMessage = {
  text: string;
  tone: "info" | "error";
};

type ClipboardSource = "manual" | "ocr" | "translation" | "clipboard";

export function TranslationWindow() {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [notice, setNotice] = useState<InlineMessage | null>(null);
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [translating, setTranslating] = useState(false);
  const [pinned, setPinned] = useState(false);
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const message = useMessage();
  const selectedEngine = resolveTranslationEngine(settings);
  const { closeWhenOutsideShell } = useFloatingWindowAutoClose({
    autoCloseOnBlur: settings.ocrResultAutoCloseOnBlur,
    currentWindow,
    label: "translation",
    pinned,
    shellSelector: ".translation-window-shell",
  });

  useEffect(() => {
    let disposed = false;

    void invoke<Partial<AppSettings> | null>("load_app_settings")
      .then((saved) => {
        if (disposed) return;
        const normalized = normalizeSavedSettings(saved);
        const fallback = Object.keys(normalized).length > 0 ? normalized : readLegacySavedSettings();
        const nextSettings = { ...fallbackSettings, ...fallback };
        setSettings(nextSettings);
      })
      .catch(() => {
        if (!disposed) {
          const nextSettings = { ...fallbackSettings, ...readLegacySavedSettings() };
          setSettings(nextSettings);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.window = "translation";
    return () => {
      delete document.documentElement.dataset.window;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        void currentWindow.close();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [currentWindow]);

  const startWindowDrag = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("button, select, input, textarea, a, [role='button'], .translation-window-controls")) {
      return;
    }

    event.preventDefault();
    void currentWindow.startDragging();
  };

  const translateText = async () => {
    if (!selectedEngine) {
      setNotice({ text: "请先在设置中启用至少一个翻译引擎。", tone: "error" });
      return;
    }

    setNotice({ text: "正在翻译...", tone: "info" });
    setTranslating(true);
    try {
      const response = await invoke<TranslateResponse>("translate_text", {
        request: {
          text: source,
          engine: selectedEngine,
          api_base_url: settings.translationApiBaseUrl,
          api_key: settings.translationApiKey,
          model: settings.translationModel,
          volc_access_key: settings.translationVolcAccessKey,
          volc_secret_key: settings.translationVolcSecretKey,
        },
      });
      setTarget(response.translated_text);
      setNotice(null);
      await writeClipboardText(response.translated_text, "translation", false);
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : String(error), tone: "error" });
    } finally {
      setTranslating(false);
    }
  };

  const copyText = async (text: string, sourceType: ClipboardSource) => {
    try {
      await writeClipboardText(text, sourceType);
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const writeClipboardText = async (text: string, sourceType: ClipboardSource, announce = true) => {
    await invoke("write_clipboard_text", {
      request: { text, source: sourceType },
    });
    if (announce) {
      message.success("复制成功");
    }
  };

  return (
    <main className="ocr-result-window translation-window" onMouseDownCapture={closeWhenOutsideShell}>
      <section aria-label="翻译" className="ocr-result-shell translation-window-shell">
        <header className="ocr-result-toolbar translation-window-toolbar" onMouseDown={startWindowDrag}>
          <button
            aria-label={pinned ? "取消固定翻译窗口" : "固定翻译窗口"}
            aria-pressed={pinned}
            className={pinned ? "ocr-pin-button active" : "ocr-pin-button"}
            onClick={() => setPinned((current) => !current)}
            title={pinned ? "取消固定" : "固定窗口"}
            type="button"
          >
            <PinIcon className="ocr-result-icon" />
          </button>
          <div className="translation-window-title">
            <TranslateIcon className="ocr-result-icon" />
            <strong>翻译</strong>
          </div>
          <div className="ocr-result-drag-spacer" />
        </header>

        <div className="translation-window-body">
          <section className="translation-pane">
            <textarea
              aria-label="原文"
              onChange={(event) => setSource(event.target.value)}
              placeholder="输入或粘贴需要翻译的文本"
              spellCheck={false}
              value={source}
            />
            <footer className="translation-pane-toolbar">
              <AppButton
                disabled={translating || !selectedEngine || !source.trim()}
                onClick={translateText}
                variant="primary"
              >
                {translating ? "翻译中..." : "翻译"}
              </AppButton>
              <AppButton disabled={!source.trim()} onClick={() => copyText(source, "manual")} variant="text">
                复制原文
              </AppButton>
              {notice && <p className={`tool-message ${notice.tone}`}>{notice.text}</p>}
            </footer>
          </section>

          <section className="translation-pane">
            <textarea
              aria-label="译文"
              onChange={(event) => setTarget(event.target.value)}
              placeholder="翻译结果会显示在这里"
              spellCheck={false}
              value={target}
            />
            <footer className="translation-pane-toolbar">
              <AppButton disabled={!target.trim()} onClick={() => copyText(target, "translation")} variant="text">
                复制译文
              </AppButton>
            </footer>
          </section>
        </div>
      </section>
    </main>
  );
}
