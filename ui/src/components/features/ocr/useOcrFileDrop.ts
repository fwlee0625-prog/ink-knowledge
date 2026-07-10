import { getCurrentWindow } from "@tauri-apps/api/window";
import type { DragEvent } from "react";
import { useEffect, useMemo, useState } from "react";

type UseOcrFileDropOptions = {
  disabled?: boolean;
  onDropPaths: (paths: string[]) => void | Promise<void>;
};

export function useOcrFileDrop({ disabled = false, onDropPaths }: UseOcrFileDropOptions) {
  const [dropActive, setDropActive] = useState(false);
  const currentWindow = useMemo(() => getCurrentWindow(), []);

  useEffect(() => {
    if (disabled) {
      setDropActive(false);
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void currentWindow
      .onDragDropEvent((event) => {
        if (disposed) return;
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDropActive(true);
          return;
        }
        if (event.payload.type === "drop") {
          setDropActive(false);
          onDropPaths(event.payload.paths);
          return;
        }
        setDropActive(false);
      })
      .then((dispose) => {
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [currentWindow, disabled, onDropPaths]);

  const handleBrowserDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (disabled) return;
    setDropActive(false);
    const paths = Array.from(event.dataTransfer.files)
      .map((file) => (file as globalThis.File & { path?: string }).path)
      .filter((path): path is string => Boolean(path));
    if (paths.length > 0) {
      onDropPaths(paths);
    }
  };

  const dropZoneProps = {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (!disabled) {
        setDropActive(true);
      }
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDropActive(false);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
    },
    onDrop: handleBrowserDrop,
  };

  return { dropActive, dropZoneProps };
}
