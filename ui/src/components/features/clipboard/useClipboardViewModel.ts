import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ClipboardHistoryItem, ClipboardTextResponse } from "../../../types";

export type ClipboardKindFilter = "all" | "text" | "image" | "files";

type ClipboardViewModelOptions = {
  onStatus?: (message: string) => void;
};

type UseClipboardItemOptions = {
  announceSuccess?: boolean;
};

export function useClipboardViewModel(options: ClipboardViewModelOptions = {}) {
  const { onStatus } = options;
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<ClipboardHistoryItem[]>([]);
  const [keyword, setKeyword] = useState("");
  const [kindFilter, setKindFilter] = useState<ClipboardKindFilter>("all");

  const notify = useCallback(
    (message: string) => {
      onStatus?.(message);
    },
    [onStatus],
  );

  const loadHistory = useCallback(async () => {
    try {
      const items = await invoke<ClipboardHistoryItem[]>("list_clipboard_history", { limit: 500 });
      setHistory(items);
    } catch (error) {
      notify(`加载剪贴板历史失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [notify]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const unlisten = listen("clipboard-changed", () => {
      void loadHistory();
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [loadHistory]);

  const visibleItems = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return history.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (!query) return true;
      if (item.text) return item.text.toLowerCase().includes(query);
      if (item.paths) return item.paths.some((path) => path.toLowerCase().includes(query));
      return false;
    });
  }, [history, keyword, kindFilter]);

  const counts = useMemo(() => {
    const nextCounts = { text: 0, image: 0, files: 0 };
    for (const item of history) {
      if (item.kind === "text") nextCounts.text += 1;
      else if (item.kind === "image") nextCounts.image += 1;
      else if (item.kind === "files") nextCounts.files += 1;
    }
    return nextCounts;
  }, [history]);

  const readCurrent = useCallback(async () => {
    setBusy(true);
    try {
      const response = await invoke<ClipboardTextResponse>("read_clipboard_text");
      if (response.text.trim()) {
        await invoke("write_clipboard_text", {
          request: { text: response.text, source: "clipboard" },
        });
        await loadHistory();
      }
      notify(response.text.trim() ? "已读取当前剪贴板文本。" : "当前剪贴板没有文本。");
    } catch (error) {
      notify(`读取当前剪贴板失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }, [loadHistory, notify]);

  const clearHistory = useCallback(async () => {
    try {
      await invoke("clear_clipboard_history");
      await loadHistory();
      notify("剪贴板历史已清空。");
    } catch (error) {
      notify(`清空剪贴板历史失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [loadHistory, notify]);

  const deleteItem = useCallback(
    async (id: string) => {
      try {
        await invoke("delete_clipboard_item", { id });
        setHistory((current) => current.filter((item) => item.id !== id));
      } catch (error) {
        notify(`删除剪贴板记录失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [notify],
  );

  const togglePinned = useCallback(
    async (id: string, pinned: boolean) => {
      try {
        await invoke("set_clipboard_pinned", { id, pinned });
        setHistory((current) => current.map((item) => (item.id === id ? { ...item, pinned } : item)));
      } catch (error) {
        notify(`更新置顶失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [notify],
  );

  const useItem = useCallback(
    async (id: string, options: UseClipboardItemOptions = {}) => {
      const { announceSuccess = true } = options;
      try {
        await invoke("use_clipboard_item", { request: { id } });
        await loadHistory();
        if (announceSuccess) {
          notify("已放入系统剪贴板，可直接粘贴。");
        }
        return true;
      } catch (error) {
        notify(`使用剪贴板记录失败: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    },
    [loadHistory, notify],
  );

  return {
    busy,
    clearHistory,
    counts,
    deleteItem,
    history,
    keyword,
    kindFilter,
    loadHistory,
    readCurrent,
    setKeyword,
    setKindFilter,
    togglePinned,
    useItem,
    visibleItems,
  };
}
