import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { OcrResultContent } from "./OcrResultContent";
import { PinIcon } from "./OcrResultIcons";
import { useFloatingWindowAutoClose } from "../floating-window/useFloatingWindowAutoClose";
import { fallbackSettings, normalizeSavedSettings, readLegacySavedSettings } from "../../../lib/settings";
import { resolveTranslationEngine } from "../../../lib/translation";
import type {
  AppSettings,
  OcrEngine,
  OcrItem,
  OcrResultData,
  ScreenshotOcrResponse,
  TranslateResponse,
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

function mapPayload(payload: OcrResultWindowPayload): OcrResultData {
  return {
    imagePath: payload.image_path,
    recognizedText: payload.recognized_text,
    items: Array.isArray(payload.items) ? payload.items : [],
    language: payload.language ?? "ch",
    engine: payload.engine ?? "apple-vision",
    source: normalizeSource(payload.source),
  };
}

function mapOcrResponse(response: ScreenshotOcrResponse): OcrResultData {
  return {
    imagePath: response.image_path,
    recognizedText: response.recognized_text,
    items: response.items,
    language: response.language,
    engine: response.engine,
    source: normalizeSource(response.source),
  };
}

export function OcrResultWindow() {
  const [data, setData] = useState<OcrResultData | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const { closeWhenOutsideShell } = useFloatingWindowAutoClose({
    autoCloseOnBlur: settings.ocrResultAutoCloseOnBlur,
    currentWindow,
    label: "ocr-result",
    pinned,
    shellSelector: ".ocr-result-shell",
  });

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

  // ESC 关闭窗口：使用捕获阶段，避免下拉、输入框等控件先拦截事件。
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

  const handleStartDrag = () => {
    void currentWindow.startDragging();
  };

  const handleLoadingToolbarMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("button, select, input, textarea, a, [role='button'], .ocr-result-controls")) {
      return;
    }

    event.preventDefault();
    handleStartDrag();
  };

  // data 还没加载时也渲染真实窗口壳，避免白屏并保留 header 原生拖拽。
  if (!data) {
    return (
      <main className="ocr-result-window" onMouseDownCapture={closeWhenOutsideShell}>
        <section aria-label="截图 OCR 识别结果" className="ocr-result-shell">
          <header className="ocr-result-toolbar" onMouseDown={handleLoadingToolbarMouseDown}>
            <button
              aria-label={pinned ? "取消固定 OCR 结果窗口" : "固定 OCR 结果窗口"}
              aria-pressed={pinned}
              className={pinned ? "ocr-pin-button active" : "ocr-pin-button"}
              onClick={() => setPinned((current) => !current)}
              title={pinned ? "取消固定" : "固定窗口"}
              type="button"
            >
              <PinIcon className="ocr-result-icon" />
            </button>
            <div className="ocr-result-drag-spacer" />
            <div className="ocr-result-controls" />
          </header>
          <div className="ocr-result-body">
            <div className="ocr-result-loading">正在加载 OCR 结果…</div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="ocr-result-window" onMouseDownCapture={closeWhenOutsideShell}>
      <OcrResultContent
        busy={busy}
        data={data}
        engine={settings.ocrEngine}
        pinned={pinned}
        onCopyText={copyText}
        onPinnedChange={setPinned}
        onRerun={rerun}
        onRetranslate={translate}
        onStartDrag={handleStartDrag}
      />
    </main>
  );
}
