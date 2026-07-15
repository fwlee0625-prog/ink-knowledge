import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import type { AppUpdateStatus } from "../types";

const initialStatus: AppUpdateStatus = {
  state: "idle",
  currentVersion: "",
};

export function useAppUpdate() {
  const [status, setStatus] = useState<AppUpdateStatus>(initialStatus);
  const [manualError, setManualError] = useState("");

  useEffect(() => {
    void invoke<AppUpdateStatus>("get_app_update_status").then(setStatus);
    const unlisten = listen<AppUpdateStatus>("app-update-status-changed", (event) => {
      setStatus(event.payload);
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const checkForUpdates = useCallback(async (): Promise<AppUpdateStatus> => {
    setManualError("");
    setStatus((current) => ({ ...current, state: "checking", error: undefined }));
    try {
      const nextStatus = await invoke<AppUpdateStatus>("check_app_update");
      setStatus(nextStatus);
      if (nextStatus.state === "error") {
        setManualError(nextStatus.error || "检查更新失败，请稍后再试。");
      }
      return nextStatus;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const nextStatus: AppUpdateStatus = {
        state: "error",
        currentVersion: status.currentVersion,
        error: message,
      };
      setManualError(message);
      setStatus((current) => ({ ...current, state: "error", error: message }));
      return nextStatus;
    }
  }, [status.currentVersion]);

  return { checkForUpdates, manualError, status };
}
