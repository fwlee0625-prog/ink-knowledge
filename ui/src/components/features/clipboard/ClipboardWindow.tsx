import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { fallbackSettings, normalizeSavedSettings, readLegacySavedSettings } from "../../../lib/settings";
import type { AppSettings } from "../../../types";
import { AppButton, useMessage } from "../../ui";
import { useFloatingWindowAutoClose } from "../floating-window/useFloatingWindowAutoClose";
import { PinIcon } from "../ocr-result-window/OcrResultIcons";
import { ClipboardFilterTabs } from "./ClipboardPage";
import { ClipboardHorizontalView } from "./ClipboardHorizontalView";
import { ClipboardVerticalView } from "./ClipboardVerticalView";
import { useClipboardViewModel } from "./useClipboardViewModel";

export function ClipboardWindow() {
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [pinned, setPinned] = useState(false);
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const message = useMessage();
  const model = useClipboardViewModel({ onStatus: (text) => message.info(text) });
  const { closeWhenOutsideShell } = useFloatingWindowAutoClose({
    autoCloseOnBlur: settings.ocrResultAutoCloseOnBlur,
    currentWindow,
    label: "clipboard",
    pinned,
    shellSelector: ".clipboard-window-shell",
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
    document.documentElement.dataset.window = "clipboard";
    return () => {
      delete document.documentElement.dataset.window;
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.code === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        void currentWindow.close();
      }
    };
    window.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("keyup", closeOnEscape, true);
    document.addEventListener("keydown", closeOnEscape, true);
    document.addEventListener("keyup", closeOnEscape, true);
    return () => {
      window.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("keyup", closeOnEscape, true);
      document.removeEventListener("keydown", closeOnEscape, true);
      document.removeEventListener("keyup", closeOnEscape, true);
    };
  }, [currentWindow]);

  const startWindowDrag = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("button, select, input, textarea, a, [role='button'], .clipboard-window-controls")) {
      return;
    }

    event.preventDefault();
    void currentWindow.startDragging();
  };

  const useItemAndClose = async (id: string) => {
    const used = await model.useItem(id, { announceSuccess: false });
    if (used) {
      await currentWindow.close();
    }
    return used;
  };

  const content =
    settings.clipboardLayout === "horizontal" ? (
      <ClipboardHorizontalView
        items={model.visibleItems}
        onDelete={model.deleteItem}
        onTogglePinned={model.togglePinned}
        onUseItem={useItemAndClose}
        totalCount={model.history.length}
      />
    ) : (
      <ClipboardVerticalView
        items={model.visibleItems}
        onDelete={model.deleteItem}
        onTogglePinned={model.togglePinned}
        onUseItem={useItemAndClose}
        totalCount={model.history.length}
      />
    );

  return (
    <main
      className={`ocr-result-window clipboard-window clipboard-layout-${settings.clipboardLayout}`}
      onMouseDownCapture={closeWhenOutsideShell}
    >
      <section aria-label="剪贴板" className="ocr-result-shell clipboard-window-shell">
        <header className="ocr-result-toolbar clipboard-window-toolbar" onMouseDown={startWindowDrag}>
          <button
            aria-label={pinned ? "取消固定剪贴板窗口" : "固定剪贴板窗口"}
            aria-pressed={pinned}
            className={pinned ? "ocr-pin-button active" : "ocr-pin-button"}
            onClick={() => setPinned((current) => !current)}
            title={pinned ? "取消固定" : "固定窗口"}
            type="button"
          >
            <PinIcon className="ocr-result-icon" />
          </button>
          <div className="clipboard-window-title">
            <strong>剪贴板</strong>
            <span>{model.visibleItems.length} 条</span>
          </div>
          <div className="ocr-result-drag-spacer" />
          <div className="clipboard-window-controls">
            <AppButton disabled={model.busy} onClick={model.readCurrent} variant="text">
              读取当前
            </AppButton>
          </div>
        </header>

        <div className="clipboard-window-body">
          <div className="clipboard-window-search">
            <input
              onChange={(event) => model.setKeyword(event.target.value)}
              placeholder="搜索内容"
              value={model.keyword}
            />
            <AppButton disabled={model.history.length === 0} onClick={model.clearHistory} variant="text">
              清空
            </AppButton>
          </div>
          <ClipboardFilterTabs
            counts={model.counts}
            kindFilter={model.kindFilter}
            onChange={model.setKindFilter}
          />
          <div className="clipboard-window-content">{content}</div>
        </div>
      </section>
    </main>
  );
}
