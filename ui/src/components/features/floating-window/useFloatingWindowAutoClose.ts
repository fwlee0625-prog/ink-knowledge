import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect } from "react";
import type { MouseEvent } from "react";

export type FloatingWindowLabel = "ocr-result" | "translation" | "clipboard";

type FloatingWindowHandle = {
  close: () => Promise<void>;
  isFocused: () => Promise<boolean>;
  onFocusChanged: (handler: (event: { payload: boolean }) => void) => Promise<() => void>;
};

type UseFloatingWindowAutoCloseOptions = {
  autoCloseOnBlur: boolean;
  currentWindow: FloatingWindowHandle;
  label: FloatingWindowLabel;
  pinned: boolean;
  shellSelector: string;
};

export function useFloatingWindowAutoClose({
  autoCloseOnBlur,
  currentWindow,
  label,
  pinned,
  shellSelector,
}: UseFloatingWindowAutoCloseOptions) {
  const enabled = autoCloseOnBlur && !pinned;

  useEffect(() => {
    void invoke("set_floating_window_auto_close", { label, enabled });
    return () => {
      void invoke("set_floating_window_auto_close", { label, enabled: false });
    };
  }, [enabled, label]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let autoCloseArmed = false;
    let closeTimer: number | undefined;
    let disposed = false;
    const armTimer = window.setTimeout(() => {
      autoCloseArmed = true;
    }, 240);

    const scheduleClose = () => {
      if (!autoCloseArmed) {
        return;
      }
      if (closeTimer !== undefined) {
        window.clearTimeout(closeTimer);
      }
      closeTimer = window.setTimeout(() => {
        void currentWindow.isFocused().then((stillFocused) => {
          if (!disposed && !stillFocused) {
            void currentWindow.close();
          }
        });
      }, 120);
    };

    const unlistenPromise = currentWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        autoCloseArmed = true;
        if (closeTimer !== undefined) {
          window.clearTimeout(closeTimer);
          closeTimer = undefined;
        }
        return;
      }

      scheduleClose();
    });
    const closeOnVisibilityHidden = () => {
      if (document.visibilityState === "hidden") {
        scheduleClose();
      }
    };
    window.addEventListener("blur", scheduleClose);
    document.addEventListener("visibilitychange", closeOnVisibilityHidden);

    return () => {
      disposed = true;
      window.clearTimeout(armTimer);
      if (closeTimer !== undefined) {
        window.clearTimeout(closeTimer);
      }
      window.removeEventListener("blur", scheduleClose);
      document.removeEventListener("visibilitychange", closeOnVisibilityHidden);
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [currentWindow, enabled]);

  const closeWhenOutsideShell = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target && !target.closest(shellSelector)) {
        void currentWindow.close();
      }
    },
    [currentWindow, enabled, shellSelector],
  );

  return { closeWhenOutsideShell };
}
