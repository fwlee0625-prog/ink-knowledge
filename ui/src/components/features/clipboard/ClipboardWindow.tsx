import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { fallbackSettings, normalizeSavedSettings, readLegacySavedSettings } from "../../../lib/settings";
import type { AppSettings } from "../../../types";
import { Button, Input, useMessage } from "../../ui";
import { useFloatingWindowAutoClose } from "../floating-window/useFloatingWindowAutoClose";
import { PinIcon } from "../ocr-result-window/OcrResultIcons";
import { ClipboardFilterTabs } from "./ClipboardPage";
import { ClipboardHorizontalView } from "./ClipboardHorizontalView";
import { ClipboardVerticalView } from "./ClipboardVerticalView";
import { useClipboardViewModel } from "./useClipboardViewModel";
import { useClipboardWindowSizing } from "./useClipboardWindowSizing";

export function ClipboardWindow() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [pinned, setPinned] = useState(false);
  const [windowReady, setWindowReady] = useState(false);
  const revealedRef = useRef(false);
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const message = useMessage();
  const model = useClipboardViewModel({ onStatus: (text) => message.info(text) });
  const revealWindow = useCallback(async () => {
    if (revealedRef.current) return;
    revealedRef.current = true;
    try {
      await currentWindow.show();
      await currentWindow.setFocus();
      setWindowReady(true);
    } catch (error) {
      revealedRef.current = false;
      throw error;
    }
  }, [currentWindow]);
  const { closeWhenOutsideShell } = useFloatingWindowAutoClose({
    autoCloseOnBlur: windowReady && Boolean(settings?.ocrResultAutoCloseOnBlur),
    currentWindow,
    label: "clipboard",
    pinned,
    shellSelector: ".clipboard-window-shell",
  });
  useClipboardWindowSizing({
    currentWindow,
    layout: settings?.clipboardLayout ?? null,
    onReady: revealWindow,
    verticalHeight: settings?.clipboardVerticalHeight ?? null,
    widthMode: settings?.clipboardWindowWidth ?? null,
  });

  useEffect(() => {
    let disposed = false;

    const loadSettings = async () => {
      try {
        const saved = await invoke<Partial<AppSettings> | null>("load_app_settings");
        if (disposed) return;
        const normalized = normalizeSavedSettings(saved);
        const fallback = Object.keys(normalized).length > 0 ? normalized : readLegacySavedSettings();
        setSettings({ ...fallbackSettings, ...fallback });
      } catch {
        if (!disposed) {
          setSettings({ ...fallbackSettings, ...readLegacySavedSettings() });
        }
      }
    };

    void loadSettings();
    const unlistenPromise = listen("app-settings-changed", () => void loadSettings());

    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten());
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

  if (!settings) return null;

  const content =
    settings.clipboardLayout === "horizontal" ? (
      <ClipboardHorizontalView
        items={model.visibleItems}
        onDelete={model.deleteItem}
        onToggleFavorite={model.toggleFavorite}
        onUseItem={useItemAndClose}
        totalCount={model.history.length}
      />
    ) : (
      <ClipboardVerticalView
        items={model.visibleItems}
        onDelete={model.deleteItem}
        onToggleFavorite={model.toggleFavorite}
        onUseItem={useItemAndClose}
        totalCount={model.history.length}
      />
    );

  return (
    <main
      className={`ocr-result-window clipboard-window clipboard-layout-${settings.clipboardLayout} clipboard-card-size-${settings.clipboardCardSize}`}
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
        </header>

        <div className="clipboard-window-body">
          <div className="clipboard-window-search">
            <Input
              onChange={(event) => model.setKeyword(event.target.value)}
              placeholder="搜索内容"
              value={model.keyword}
            />
            {model.keyword && (
              <Button
                aria-label="清除搜索"
                className="clipboard-search-clear"
                onClick={() => model.setKeyword("")}
                size="icon"
                title="清除搜索"
                variant="ghost"
              >
                <X />
              </Button>
            )}
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
