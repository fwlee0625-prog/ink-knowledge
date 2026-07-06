import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { AppButton, AppSelect, useMessage } from "../../ui";
import type { OcrDialogData, OcrEngine, OcrItem } from "../../../types";

type OcrResultDialogProps = {
  busy: boolean;
  data: OcrDialogData | null;
  onClose: () => void;
  onCopyText: (text: string, source?: "ocr" | "translation" | "manual") => Promise<void>;
  onRetranslate: (text: string) => Promise<string>;
  onRerun: (imagePath: string, engine: OcrEngine, language: string) => Promise<void>;
  onStartDrag: () => void;
};

type ImageSize = {
  width: number;
  height: number;
};

type OcrBoxStyle = {
  left: string;
  top: string;
  width: string;
  height: string;
};

const OCR_ENGINE_OPTIONS = [
  { label: "离线文本识别", value: "apple-vision" },
  { label: "PaddleOCR 扩展", value: "paddle" },
] satisfies { label: string; value: OcrEngine }[];

const OCR_LANGUAGE_OPTIONS = [
  { label: "中文简体", value: "ch" },
  { label: "中文简体", value: "zh-Hans" },
  { label: "中文繁体", value: "zh-Hant" },
  { label: "英文", value: "en" },
] satisfies { label: string; value: string }[];

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function itemToBoxStyle(item: OcrItem, imageSize: ImageSize | null): OcrBoxStyle | null {
  const box = item.box;
  if (!box || box.length < 4) {
    return null;
  }

  const [x1, y1, x2, y2] = box;
  const values = [x1, y1, x2, y2];
  if (!values.every((value) => Number.isFinite(value))) {
    return null;
  }

  const normalized = values.every((value) => value >= 0 && value <= 1);
  if (!normalized && (!imageSize || imageSize.width <= 0 || imageSize.height <= 0)) {
    return null;
  }

  const widthBase = normalized ? 1 : imageSize?.width ?? 1;
  const heightBase = normalized ? 1 : imageSize?.height ?? 1;
  const left = clampPercent((Math.min(x1, x2) / widthBase) * 100);
  const top = clampPercent((Math.min(y1, y2) / heightBase) * 100);
  const right = clampPercent((Math.max(x1, x2) / widthBase) * 100);
  const bottom = clampPercent((Math.max(y1, y2) / heightBase) * 100);
  const width = Math.max(0.35, right - left);
  const height = Math.max(0.35, bottom - top);

  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${width}%`,
    height: `${height}%`,
  };
}

export function OcrResultDialog({
  busy,
  data,
  onClose,
  onCopyText,
  onRetranslate,
  onRerun,
  onStartDrag,
}: OcrResultDialogProps) {
  const [text, setText] = useState("");
  const [translation, setTranslation] = useState("");
  const [notice, setNotice] = useState("");
  const [language, setLanguage] = useState("ch");
  const [engine, setEngine] = useState<OcrEngine>("apple-vision");
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const message = useMessage();

  useEffect(() => {
    setText(data?.recognizedText ?? "");
    setTranslation("");
    setNotice("");
    setLanguage(data?.language ?? "ch");
    setEngine(data?.engine ?? "apple-vision");
    setImageSize(null);
  }, [data]);

  useEffect(() => {
    if (!data) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [data, onClose]);

  const imageSrc = useMemo(() => (data ? convertFileSrc(data.imagePath) : ""), [data]);
  const ocrBoxStyles = useMemo(
    () =>
      data?.items
        .map((item) => ({
          item,
          style: itemToBoxStyle(item, imageSize),
        }))
        .filter((entry): entry is { item: OcrItem; style: OcrBoxStyle } => Boolean(entry.style)) ?? [],
    [data?.items, imageSize],
  );

  if (!data) {
    return null;
  }

  const startWindowDrag = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("button, select, input, textarea, a, [role='button'], .ocr-dialog-controls")) {
      return;
    }

    event.preventDefault();
    onStartDrag();
  };

  const runTranslate = async () => {
    try {
      setNotice("");
      const translated = await onRetranslate(text);
      setTranslation(translated);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const runRerun = async () => {
    try {
      setNotice("");
      await onRerun(data.imagePath, engine, language);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const runCopy = async () => {
    try {
      setNotice("");
      await onCopyText(text, "ocr");
      message.success("复制成功");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  const exportText = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "screenshot-ocr.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="ocr-dialog-backdrop" role="presentation">
      <section aria-label="截图 OCR 识别结果" className="ocr-dialog" role="dialog">
        <header className="ocr-dialog-toolbar" onMouseDown={startWindowDrag}>
          <div className="ocr-dialog-pin">
            图
          </div>
          <div className="ocr-dialog-drag-spacer" />
          <div className="ocr-dialog-controls">
            <AppSelect
              ariaLabel="OCR 引擎"
              className="ocr-engine-select"
              onChange={setEngine}
              options={OCR_ENGINE_OPTIONS}
              value={engine}
            />
            <AppButton disabled={busy} onClick={runRerun} variant="text">
              重新识别
            </AppButton>
            <AppButton disabled={busy || !text} onClick={runTranslate} variant="text">
              翻译
            </AppButton>
            <AppButton disabled={!text} onClick={exportText} variant="text">
              导出
            </AppButton>
          </div>
        </header>

        <div className="ocr-dialog-body">
          <div className="ocr-preview-pane">
            <div className="ocr-image-stage">
              <div className="ocr-image-frame">
                <img
                  alt="截图预览"
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    setImageSize({
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                    });
                  }}
                  src={imageSrc}
                />
                {ocrBoxStyles.map(({ item, style }, index) => (
                  <span
                    aria-hidden="true"
                    className="ocr-box-hint"
                    key={`${item.page}-${item.text}-${index}`}
                    style={style}
                  />
                ))}
              </div>
            </div>
            <div className="ocr-preview-toolbar">
              <span>{data.source === "screenshotOcr" ? "截图 OCR" : "截图快捷 OCR"}</span>
              <span>{data.items.length} 个识别片段</span>
            </div>
          </div>

          <div className="ocr-text-pane">
            <textarea
              aria-label="识别文本"
              onChange={(event) => setText(event.target.value)}
              spellCheck={false}
              value={text}
            />
            <footer className="ocr-text-toolbar">
              <AppButton disabled={!text} onClick={runCopy} variant="text">
                复制文本
              </AppButton>
              <AppSelect
                ariaLabel="OCR 语言"
                className="ocr-language-select"
                onChange={setLanguage}
                options={OCR_LANGUAGE_OPTIONS}
                value={language}
              />
            </footer>
            {translation && (
              <div className="translation-result">
                <strong>翻译结果</strong>
                <p>{translation}</p>
              </div>
            )}
            {notice && (
              <div className="translation-result">
                <strong>提示</strong>
                <p>{notice}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
