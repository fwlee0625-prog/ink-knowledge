import { currentMonitor, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { useEffect } from "react";
import type { Window } from "@tauri-apps/api/window";
import type { ClipboardLayout, ClipboardVerticalHeight, ClipboardWindowWidth } from "../../../types";

type ClipboardWindowSizingOptions = {
  currentWindow: Window;
  layout: ClipboardLayout | null;
  onReady?: () => void | Promise<void>;
  verticalHeight: ClipboardVerticalHeight | null;
  widthMode: ClipboardWindowWidth | null;
};

const DEFAULT_HORIZONTAL_WIDTH = 1280;
const HORIZONTAL_HEIGHT = 440;
const VERTICAL_WIDTH = 620;
const VERTICAL_HEIGHTS: Record<ClipboardVerticalHeight, number> = {
  small: 560,
  default: 720,
  large: 880,
};
const WINDOW_MARGIN = 28;

export function useClipboardWindowSizing({
  currentWindow,
  layout,
  onReady,
  verticalHeight,
  widthMode,
}: ClipboardWindowSizingOptions) {
  useEffect(() => {
    if (!layout || !verticalHeight || !widthMode) return;

    let disposed = false;

    void (async () => {
      try {
        await resizeClipboardWindow(currentWindow, layout, widthMode, verticalHeight, () => disposed);
      } catch (error) {
        console.error("调整剪贴板窗口尺寸失败", error);
      }

      if (!disposed) {
        await onReady?.();
      }
    })().catch((error) => {
      console.error("显示剪贴板窗口失败", error);
    });

    return () => {
      disposed = true;
    };
  }, [currentWindow, layout, onReady, verticalHeight, widthMode]);
}

async function resizeClipboardWindow(
  currentWindow: Window,
  layout: ClipboardLayout,
  widthMode: ClipboardWindowWidth,
  verticalHeight: ClipboardVerticalHeight,
  isDisposed: () => boolean,
) {
  const monitor = await currentMonitor();
  if (!monitor || isDisposed()) return;

  const { position, size } = monitor.workArea;
  const scale = monitor.scaleFactor;
  const margin = Math.round(WINDOW_MARGIN * scale);

  const targetWidth =
    layout === "vertical"
      ? Math.min(Math.round(VERTICAL_WIDTH * scale), size.width - margin * 2)
      : resolveHorizontalWidth(widthMode, size.width, scale);
  const targetHeight =
    layout === "vertical"
      ? Math.min(Math.round(VERTICAL_HEIGHTS[verticalHeight] * scale), size.height - margin * 2)
      : Math.min(Math.round(HORIZONTAL_HEIGHT * scale), size.height - margin * 2);

  if (isDisposed()) return;
  await currentWindow.setMinSize(
    new PhysicalSize(
      Math.min(Math.round(640 * scale), targetWidth),
      Math.min(Math.round(360 * scale), targetHeight),
    ),
  );
  await currentWindow.setSize(new PhysicalSize(targetWidth, targetHeight));

  const x = position.x + Math.round((size.width - targetWidth) / 2);
  const y =
    layout === "vertical"
      ? position.y + Math.round((size.height - targetHeight) / 2)
      : position.y + size.height - targetHeight;
  if (!isDisposed()) {
    await currentWindow.setPosition(new PhysicalPosition(x, Math.max(position.y + margin, y)));
  }
}

function resolveHorizontalWidth(mode: ClipboardWindowWidth, workWidth: number, scale: number) {
  if (mode === "half") return Math.round(workWidth * 0.5);
  if (mode === "full") return workWidth;
  return Math.min(Math.round(DEFAULT_HORIZONTAL_WIDTH * scale), workWidth);
}
