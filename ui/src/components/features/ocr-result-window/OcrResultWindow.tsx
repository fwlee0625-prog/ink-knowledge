import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { OcrResultDialog } from "./OcrResultDialog";
import { fallbackSettings, normalizeSavedSettings, readLegacySavedSettings } from "../../../lib/settings";
import type {
  AppSettings,
  OcrDialogData,
  OcrEngine,
  OcrItem,
  ScreenshotOcrResponse,
  TranslateResponse,
  TranslationEngine,
} from "../../../types";

type OcrResultWindowPayload = {
  image_path: string;
  recognized_text: string;
  items: OcrItem[] | null;
  language: string | null;
  engine: OcrEngine | null;
  source: "screenshot" | "screenshotOcr" | "fileOcr" | null;
};

function normalizeSource(source: unknown): "screenshot" | "screenshotOcr" | "fileOcr" {
  return source === "screenshot" || source === "screenshotOcr" || source === "fileOcr" ? source : "screenshotOcr";
}

function mapPayload(payload: OcrResultWindowPayload): OcrDialogData {
  return {
    imagePath: payload.image_path,
    recognizedText: payload.recognized_text,
    items: Array.isArray(payload.items) ? payload.items : [],
    language: payload.language ?? "ch",
    engine: payload.engine ?? "apple-vision",
    source: normalizeSource(payload.source),
  };
}

function mapOcrResponse(response: ScreenshotOcrResponse): OcrDialogData {
  return {
    imagePath: response.image_path,
    recognizedText: response.recognized_text,
    items: response.items,
    language: response.language,
    engine: response.engine,
    source: normalizeSource(response.source),
  };
}

function isTranslationEngineEnabled(settings: AppSettings, engine: TranslationEngine) {
  if (engine === "openai-compatible") return settings.translationOpenaiEnabled;
  return settings.translationVolcEnabled;
}

function resolveTranslationEngine(settings: AppSettings): TranslationEngine | null {
  if (isTranslationEngineEnabled(settings, settings.translationEngine)) {
    return settings.translationEngine;
  }
  if (settings.translationOpenaiEnabled) return "openai-compatible";
  if (settings.translationVolcEnabled) return "volcengine";
  return null;
}

export function OcrResultWindow() {
  const [data, setData] = useState<OcrDialogData | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const currentWindow = useMemo(() => getCurrentWindow(), []);

  useEffect(() => {
    let disposed = false;

    void invoke<Partial<AppSettings> | null>("load_app_settings")
      .then((saved) => {
        if (disposed) return;
        const normalized = normalizeSavedSettings(saved);
        const fallback = Object.keys(normalized).length > 0 ? normalized : readLegacySavedSettings();
        setSettings({ ...fallbackSettings, ...fallback });
      })
      .catch(() => {
        if (!disposed) {
          setSettings({ ...fallbackSettings, ...readLegacySavedSettings() });
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.window = "ocr-result";
    return () => {
      delete document.documentElement.dataset.window;
    };
  }, []);

  // ESC 关闭窗口：放在顶层，确保 data 为 null 时也能响应
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void currentWindow.close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentWindow]);

  useEffect(() => {
    if (!settings.ocrResultAutoCloseOnBlur) {
      return;
    }

    let hasBeenFocused = false;
    let closeTimer: number | undefined;
    let disposed = false;

    void currentWindow.isFocused().then((focused) => {
      if (!disposed && focused) {
        hasBeenFocused = true;
      }
    });

    const unlistenPromise = currentWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        hasBeenFocused = true;
        if (closeTimer !== undefined) {
          window.clearTimeout(closeTimer);
          closeTimer = undefined;
        }
        return;
      }

      if (!hasBeenFocused) {
        return;
      }

      closeTimer = window.setTimeout(() => {
        void currentWindow.isFocused().then((stillFocused) => {
          if (!stillFocused) {
            void currentWindow.close();
          }
        });
      }, 120);
    });

    return () => {
      disposed = true;
      if (closeTimer !== undefined) {
        window.clearTimeout(closeTimer);
      }
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [currentWindow, settings.ocrResultAutoCloseOnBlur]);

  useEffect(() => {
    void invoke<OcrResultWindowPayload | null>("get_pending_ocr_result").then((payload) => {
      if (payload) {
        setData(mapPayload(payload));
      }
    });

    const unlisten = listen<OcrResultWindowPayload>("ocr-result-updated", (event) => {
      setData(mapPayload(event.payload));
    });

    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const copyText = async (text: string) => {
    await invoke("write_clipboard_text", {
      request: { text },
    });
  };

  const rerun = async (imagePath: string, engine: OcrEngine, language: string) => {
    setBusy(true);
    try {
      const response = await invoke<ScreenshotOcrResponse>("run_screenshot_ocr", {
        request: {
          image_path: imagePath,
          output_dir: settings.outputDir || undefined,
          ocr_engine: engine,
          dpi: settings.dpi,
          lang: language,
          force_ocr: settings.forceOcr,
        },
      });
      setData(mapOcrResponse(response));
    } finally {
      setBusy(false);
    }
  };

  const translate = async (text: string) => {
    const engine = resolveTranslationEngine(settings);
    if (!engine) {
      throw new Error("请先在设置中启用至少一个翻译引擎。");
    }
    const response = await invoke<TranslateResponse>("translate_text", {
      request: {
        text,
        engine,
        api_base_url: settings.translationApiBaseUrl,
        api_key: settings.translationApiKey,
        model: settings.translationModel,
        volc_access_key: settings.translationVolcAccessKey,
        volc_secret_key: settings.translationVolcSecretKey,
      },
    });
    await copyText(response.translated_text);
    return response.translated_text;
  };

  const handleClose = () => {
    void currentWindow.close();
  };

  const handleStartDrag = () => {
    void currentWindow.startDragging();
  };

  const handleLoadingToolbarMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("button, select, input, textarea, a, [role='button'], .ocr-dialog-controls")) {
      return;
    }

    event.preventDefault();
    handleStartDrag();
  };

  // data 还没加载时显示 loading 框，避免白屏且支持 ESC/关闭按钮
  if (!data) {
    return (
      <div className="ocr-dialog-backdrop" role="presentation">
        <section aria-label="截图 OCR 识别结果" className="ocr-dialog" role="dialog">
          <header className="ocr-dialog-toolbar" onMouseDown={handleLoadingToolbarMouseDown}>
            <div className="ocr-dialog-pin">
              图
            </div>
            <div className="ocr-dialog-drag-spacer" />
            <div className="ocr-dialog-controls" />
          </header>
          <div className="ocr-dialog-body">
            <div className="ocr-dialog-loading">正在加载 OCR 结果…</div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <OcrResultDialog
      busy={busy}
      data={data}
      onClose={handleClose}
      onCopyText={copyText}
      onRerun={rerun}
      onRetranslate={translate}
      onStartDrag={handleStartDrag}
    />
  );
}
