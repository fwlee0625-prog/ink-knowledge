import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { AppButton, AppSelect, useMessage } from "../../ui";
import { PinIcon, RefreshIcon, TranslateIcon } from "./OcrResultIcons";
import { ocrLanguageOptions } from "../../../lib/ocrLanguages";
import type { OcrEngine, OcrItem, OcrResultData } from "../../../types";

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

type OcrResultContentProps = {
  busy: boolean;
  data: OcrResultData;
  engine: OcrEngine;
  pinned: boolean;
  onCopyText: (text: string, source?: "ocr" | "translation" | "manual") => Promise<void>;
  onPinnedChange: (pinned: boolean) => void;
  onRetranslate: (text: string) => Promise<string>;
  onRerun: (imagePath: string, engine: OcrEngine, language: string) => Promise<void>;
  onStartDrag: () => void;
};

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

export function OcrResultContent({
  busy,
  data,
  engine,
  pinned,
  onCopyText,
  onPinnedChange,
  onRetranslate,
  onRerun,
  onStartDrag,
}: OcrResultContentProps) {
  const [text, setText] = useState("");
  const [translation, setTranslation] = useState("");
  const [notice, setNotice] = useState("");
  const [language, setLanguage] = useState("ch");
  const [imageSize, setImageSize] = useState<ImageSize | null>(null);
  const message = useMessage();

  useEffect(() => {
    setText(data?.recognizedText ?? "");
    setTranslation("");
    setNotice("");
    setLanguage(data?.language ?? "ch");
    setImageSize(null);
  }, [data]);

  const imageSrc = useMemo(() => convertFileSrc(data.imagePath), [data.imagePath]);
  const ocrBoxStyles = useMemo(
    () =>
      data.items
        .map((item) => ({
          item,
          style: itemToBoxStyle(item, imageSize),
        }))
        .filter((entry): entry is { item: OcrItem; style: OcrBoxStyle } => Boolean(entry.style)),
    [data.items, imageSize],
  );

  const startWindowDrag = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("button, select, input, textarea, a, [role='button'], .ocr-result-controls")) {
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

  return (
    <section aria-label="截图 OCR 识别结果" className="ocr-result-shell">
      <header className="ocr-result-toolbar" onMouseDown={startWindowDrag}>
        <button
          aria-label={pinned ? "取消固定 OCR 结果窗口" : "固定 OCR 结果窗口"}
          aria-pressed={pinned}
          className={pinned ? "ocr-pin-button active" : "ocr-pin-button"}
          onClick={() => onPinnedChange(!pinned)}
          title={pinned ? "取消固定" : "固定窗口"}
          type="button"
        >
          <PinIcon className="ocr-result-icon" />
        </button>
        <div className="ocr-result-drag-spacer" />
        <div className="ocr-result-controls">
          <button
            aria-label="重新识别"
            className="ocr-result-icon-button"
            disabled={busy}
            onClick={runRerun}
            title="重新识别"
            type="button"
          >
            <RefreshIcon className="ocr-result-icon" />
          </button>
          <button
            aria-label="翻译"
            className="ocr-result-icon-button"
            disabled={busy || !text}
            onClick={runTranslate}
            title="翻译"
            type="button"
          >
            <TranslateIcon className="ocr-result-icon" />
          </button>
        </div>
      </header>

      <div className="ocr-result-body">
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
              options={ocrLanguageOptions}
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
  );
}
