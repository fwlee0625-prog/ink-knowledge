import { convertFileSrc } from "@tauri-apps/api/core";
import { useMemo } from "react";
import { AppButton, Card, EmptyState } from "../../ui";
import type { ScreenshotResponse } from "../../../types";

type ScreenshotPageProps = {
  busy: boolean;
  screenshot: ScreenshotResponse | null;
  onCapture: () => Promise<void>;
  onCopy: () => Promise<void>;
  onOcr: () => Promise<void>;
  onSave: () => Promise<void>;
  onClear: () => void;
};

export function ScreenshotPage({
  busy,
  screenshot,
  onCapture,
  onCopy,
  onOcr,
  onSave,
  onClear,
}: ScreenshotPageProps) {
  const previewSrc = useMemo(() => (screenshot ? convertFileSrc(screenshot.image_path) : ""), [screenshot]);

  return (
    <section className="tool-workspace">
      <Card className="tool-panel">
        <div className="tool-title">
          <p className="eyebrow">Capture</p>
          <h2>截图</h2>
          <span>普通截图独立运行，截图完成后可以保存、复制，或点击 OCR 快捷按钮识别当前截图。</span>
        </div>
        <div className="button-row">
          <AppButton disabled={busy} onClick={onCapture} variant="primary">
            区域截图
          </AppButton>
          <AppButton disabled={busy || !screenshot} onClick={onSave}>
            保存
          </AppButton>
          <AppButton disabled={busy || !screenshot} onClick={onCopy}>
            复制
          </AppButton>
        </div>
      </Card>

      <Card className="screenshot-stage" variant="result">
        {screenshot ? (
          <>
            <div className="screenshot-preview">
              <img alt={screenshot.file_name} src={previewSrc} />
            </div>
            <div className="floating-capture-toolbar">
              <AppButton disabled={busy} onClick={onOcr} variant="primary">
                OCR
              </AppButton>
              <AppButton disabled={busy} onClick={onSave} variant="text">
                保存
              </AppButton>
              <AppButton disabled={busy} onClick={onCopy} variant="text">
                复制
              </AppButton>
              <AppButton onClick={onClear} variant="text">
                关闭
              </AppButton>
              <AppButton disabled={busy} onClick={onSave} variant="text">
                确认
              </AppButton>
            </div>
          </>
        ) : (
          <EmptyState variant="result">截图后会在这里显示预览和浮动工具栏。</EmptyState>
        )}
      </Card>
    </section>
  );
}
