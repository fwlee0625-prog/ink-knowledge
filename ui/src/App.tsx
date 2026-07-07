import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardPage } from "./components/features/clipboard/ClipboardPage";
import { OcrPage } from "./components/features/ocr/OcrPage";
import { SettingsPage } from "./components/features/settings/SettingsPage";
import { AppButton, useConfirmDialog } from "./components/ui";
import { clampNumber, fileName, getOutputFormat, outputFileName, primaryOutputPath } from "./lib/format";
import {
  clearLegacySavedSettings,
  fallbackSettings,
  normalizeSavedSettings,
  readLegacySavedSettings,
} from "./lib/settings";
import { useThemeMode } from "./lib/theme";
import type {
  AppSettings,
  BackendStatus,
  ClearOcrOutputResponse,
  ClipboardHistoryItem,
  ClipboardRepoConfig,
  ClipboardTextResponse,
  DefaultSettings,
  ExtensionInfo,
  NativeCaptureResponse,
  OcrEngine,
  OcrResponse,
  RecognitionFile,
  RecognitionProgress,
  SaveScreenshotResponse,
  ShortcutBindings,
  ScreenshotOcrResponse,
  ScreenshotResponse,
  View,
} from "./types";

const settingsSaveDebounceMs = 500;

type PendingSettingsSave = {
  message: string;
  serialized: string;
  settings: AppSettings;
};

type TrayOpenView = View | "screenshot" | "screenshotOcr";

function normalizeTrayView(view: TrayOpenView): View {
  return view === "ocr" || view === "clipboard" || view === "settings"
    ? view
    : "ocr";
}

export function App() {
  const [view, setView] = useState<View>("ocr");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [recognizedFiles, setRecognizedFiles] = useState<RecognitionFile[]>([]);
  const [progress, setProgress] = useState<RecognitionProgress>(null);
  const [screenshot, setScreenshot] = useState<ScreenshotResponse | null>(null);
  const [clipboardHistory, setClipboardHistory] = useState<ClipboardHistoryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const persistedSettingsJsonRef = useRef("");
  const pendingSettingsSaveRef = useRef<PendingSettingsSave | null>(null);
  const queuedSettingsJsonRef = useRef("");
  const settingsSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const settingsSaveTimerRef = useRef<number | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const resolvedTheme = useThemeMode(settings.themePreference);

  useEffect(() => {
    const unlisten = listen<TrayOpenView>("tray-open-view", (event) => {
      setView(normalizeTrayView(event.payload));
    });

    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const unlisten = listen<NativeCaptureResponse>("native-capture-finished", (event) => {
      const response = event.payload;
      setLog(response.message);
      if (response.imagePath && response.fileName) {
        setScreenshot({
          image_path: response.imagePath,
          file_name: response.fileName,
          message: response.message,
        });
      }
    });

    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  const runBusy = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setLog(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const registerShortcuts = useCallback(async (bindings: ShortcutBindings) => {
    try {
      await invoke("register_shortcuts", { bindings });
    } catch (error) {
      setLog(`注册快捷键失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const loadClipboardHistory = useCallback(async () => {
    try {
      const items = await invoke<ClipboardHistoryItem[]>("list_clipboard_history", { limit: 500 });
      setClipboardHistory(items);
    } catch (error) {
      setLog(`加载剪贴板历史失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const syncClipboardConfig = useCallback(async (nextSettings: AppSettings) => {
    try {
      const config: ClipboardRepoConfig = {
        max_items: nextSettings.clipboardHistoryLimit,
      };
      await invoke("update_clipboard_config", { config });
      await invoke("set_clipboard_polling", { enabled: nextSettings.clipboardRecordText });
    } catch (error) {
      setLog(`同步剪贴板配置失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const loadDefaultSettings = useCallback(async () => {
    const defaults = await invoke<DefaultSettings>("get_default_settings");
    const baseSettings: AppSettings = {
      ...fallbackSettings,
      outputDir: defaults.output_dir,
      screenshotOutputDir: defaults.screenshot_output_dir,
      ocrEngine: defaults.ocr_engine,
      dpi: defaults.dpi,
      lang: defaults.lang,
      forceOcr: defaults.force_ocr,
      outputTxt: defaults.output_txt,
      outputJson: defaults.output_json,
      recursionDepth: defaults.recursion_depth,
      clearOcrResultsBeforeRun: fallbackSettings.clearOcrResultsBeforeRun,
    };

    const storedSettings = await invoke<Partial<AppSettings> | null>("load_app_settings");
    let saved = normalizeSavedSettings(storedSettings);
    let migratingLegacySettings = false;
    if (Object.keys(saved).length === 0) {
      const legacySettings = readLegacySavedSettings();
      if (Object.keys(legacySettings).length > 0) {
        saved = legacySettings;
        migratingLegacySettings = true;
        void invoke("save_app_settings", { settings: { ...baseSettings, ...legacySettings } })
          .then(() => {
            persistedSettingsJsonRef.current = JSON.stringify({ ...baseSettings, ...legacySettings });
            queuedSettingsJsonRef.current = "";
            clearLegacySavedSettings();
          })
          .catch((error) => {
            setLog(`迁移旧设置失败: ${error instanceof Error ? error.message : String(error)}`);
          });
      }
    }
    const nextSettings = { ...baseSettings, ...saved };
    nextSettings.recursionDepth = clampNumber(nextSettings.recursionDepth, 1, 5);
    nextSettings.clipboardHistoryLimit = clampNumber(nextSettings.clipboardHistoryLimit, 10, 500);
    if (!migratingLegacySettings) {
      persistedSettingsJsonRef.current = JSON.stringify(nextSettings);
      queuedSettingsJsonRef.current = "";
    }
    setSettings(nextSettings);
    // 用 SQLite 中保存的偏好覆盖后端默认绑定；忽略失败，避免阻塞设置加载。
    void registerShortcuts(nextSettings.shortcutBindings);
    // 同步剪贴板历史容量和轮询开关到后端
    void syncClipboardConfig(nextSettings);
  }, [registerShortcuts, syncClipboardConfig]);

  useEffect(() => {
    void loadDefaultSettings();
    void loadClipboardHistory();
  }, [loadDefaultSettings, loadClipboardHistory]);

  // 监听后端剪贴板变化事件，自动刷新历史
  useEffect(() => {
    const unlisten = listen("clipboard-changed", () => {
      void loadClipboardHistory();
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [loadClipboardHistory]);

  const checkBackend = useCallback(async () => {
    await runBusy(async () => {
      const nextStatus = await invoke<BackendStatus>("check_backend");
      const nextExtensions = await invoke<ExtensionInfo[]>("list_extensions");
      setStatus(nextStatus);
      setExtensions(nextExtensions);
      setLog(nextStatus.message);
    });
  }, [runBusy]);

  const loadExtensions = useCallback(async () => {
    const nextExtensions = await invoke<ExtensionInfo[]>("list_extensions");
    setExtensions(nextExtensions);
  }, []);

  useEffect(() => {
    void loadExtensions().catch((error) => {
      setLog(`读取扩展状态失败: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, [loadExtensions]);

  const installExtension = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      });

      if (typeof selected !== "string") {
        return;
      }

      await runBusy(async () => {
        const installed = await invoke<ExtensionInfo>("install_extension_from_dir", {
          request: {
            source_dir: selected,
          },
        });
        const nextExtensions = await invoke<ExtensionInfo[]>("list_extensions");
        const nextStatus = await invoke<BackendStatus>("check_backend");
        setExtensions(nextExtensions);
        setStatus(nextStatus);
        setLog(`已安装扩展: ${installed.name} ${installed.version ?? ""}`);
      });
    } catch (error) {
      setLog(`安装扩展失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const uninstallExtension = async (id: string, name: string) => {
    if (
      !(await confirm({
        cancelText: "取消",
        confirmText: "卸载",
        description: `将从 App 数据目录删除 ${name} 扩展。`,
        title: "卸载扩展",
        tone: "danger",
      }))
    ) {
      return;
    }

    await runBusy(async () => {
      const nextExtensions = await invoke<ExtensionInfo[]>("uninstall_extension", {
        request: { id },
      });
      const nextStatus = await invoke<BackendStatus>("check_backend");
      setExtensions(nextExtensions);
      setStatus(nextStatus);
      setLog(`已卸载扩展: ${name}`);
    });
  };

  const confirmReplaceSelected = async () => {
    if (selectedFiles.length === 0) {
      return true;
    }

    return confirm({
      cancelText: "取消",
      confirmText: "清空并选择",
      description: "当前已选择文件列表有数据，继续操作会先清空现有列表。",
      title: "重新选择",
      tone: "warning",
    });
  };

  const chooseFile = async () => {
    try {
      if (!(await confirmReplaceSelected())) {
        return;
      }

      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "OCR Files",
            extensions: ["pdf", "png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff"],
          },
        ],
      });

      const paths = Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
      if (paths.length > 0) {
        setSelectedFiles(paths);
        setRecognizedFiles([]);
        setLog(`已选择 ${paths.length} 个文件。`);
      }
    } catch (error) {
      setLog(`选择文件失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const chooseFolder = async () => {
    try {
      if (!(await confirmReplaceSelected())) {
        return;
      }

      const selected = await open({
        multiple: false,
        directory: true,
      });

      if (typeof selected !== "string") {
        return;
      }

      const paths = await invoke<string[]>("scan_supported_files", {
        request: {
          root_dir: selected,
          max_depth: settings.recursionDepth,
        },
      });

      setSelectedFiles(paths);
      setRecognizedFiles([]);
      setLog(`已从文件夹找到 ${paths.length} 个支持的文件。`);
    } catch (error) {
      setLog(`选择文件夹失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const persistSettings = useCallback(
    (nextSettings: AppSettings, message = "设置已自动保存。", immediate = false) => {
      if (!nextSettings.outputTxt && !nextSettings.outputJson) {
        setLog("请至少选择一种输出格式。");
        return;
      }

      const serialized = JSON.stringify(nextSettings);
      if (persistedSettingsJsonRef.current === serialized) {
        return;
      }
      if (!immediate && queuedSettingsJsonRef.current === serialized) {
        return;
      }

      pendingSettingsSaveRef.current = { message, serialized, settings: nextSettings };
      queuedSettingsJsonRef.current = serialized;

      const flushPendingSettings = () => {
        if (settingsSaveTimerRef.current !== null) {
          window.clearTimeout(settingsSaveTimerRef.current);
          settingsSaveTimerRef.current = null;
        }

        const pending = pendingSettingsSaveRef.current;
        if (!pending) return;
        pendingSettingsSaveRef.current = null;
        if (persistedSettingsJsonRef.current === pending.serialized) {
          if (queuedSettingsJsonRef.current === pending.serialized) {
            queuedSettingsJsonRef.current = "";
          }
          return;
        }

        const saveTask = settingsSaveChainRef.current
          .catch(() => undefined)
          .then(async () => {
            await invoke("save_app_settings", { settings: pending.settings });
            persistedSettingsJsonRef.current = pending.serialized;
            if (queuedSettingsJsonRef.current === pending.serialized) {
              queuedSettingsJsonRef.current = "";
            }
            // 快捷键需要通知后端重新注册才能生效；其他设置项在前端状态中即时读取。
            void registerShortcuts(pending.settings.shortcutBindings);
            // 剪贴板历史容量和轮询开关也需同步到后端
            void syncClipboardConfig(pending.settings);
            setLog(pending.message);
          })
          .catch((error) => {
            if (queuedSettingsJsonRef.current === pending.serialized) {
              queuedSettingsJsonRef.current = "";
            }
            setLog(`保存设置失败: ${error instanceof Error ? error.message : String(error)}`);
          });

        settingsSaveChainRef.current = saveTask.then(() => undefined).catch(() => undefined);
      };

      if (immediate) {
        flushPendingSettings();
        return;
      }

      if (settingsSaveTimerRef.current !== null) {
        window.clearTimeout(settingsSaveTimerRef.current);
      }
      settingsSaveTimerRef.current = window.setTimeout(flushPendingSettings, settingsSaveDebounceMs);
    },
    [registerShortcuts, syncClipboardConfig],
  );

  const chooseOutputDir = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      });

      if (typeof selected === "string") {
        const nextSettings = { ...settings, outputDir: selected };
        setSettings(nextSettings);
        persistSettings(nextSettings, `已选择并保存存储目录: ${selected}`, true);
      }
    } catch (error) {
      setLog(`选择存储目录失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const chooseScreenshotOutputDir = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      });

      if (typeof selected === "string") {
        const nextSettings = { ...settings, screenshotOutputDir: selected };
        setSettings(nextSettings);
        persistSettings(nextSettings, `已选择并保存截图目录: ${selected}`, true);
      }
    } catch (error) {
      setLog(`选择截图目录失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const resetSettings = async () => {
    await runBusy(async () => {
      await invoke("clear_app_settings");
      clearLegacySavedSettings();
      persistedSettingsJsonRef.current = "";
      pendingSettingsSaveRef.current = null;
      queuedSettingsJsonRef.current = "";
      if (settingsSaveTimerRef.current !== null) {
        window.clearTimeout(settingsSaveTimerRef.current);
        settingsSaveTimerRef.current = null;
      }
      await loadDefaultSettings();
      setLog("已恢复默认设置。");
    });
  };

  const runOcr = async () => {
    if (selectedFiles.length === 0) {
      setLog("请先选择图片或 PDF。");
      return;
    }

    await runBusy(async () => {
      const nextResults: RecognitionFile[] = [];
      const previousResults = settings.clearOcrResultsBeforeRun ? [] : recognizedFiles;
      setRecognizedFiles(previousResults);
      setProgress({ current: 0, total: selectedFiles.length });
      let removedOutputCount = 0;

      if (settings.clearOcrResultsBeforeRun) {
        const response = await invoke<ClearOcrOutputResponse>("clear_ocr_output_dir", {
          request: {
            output_dir: settings.outputDir,
          },
        });
        removedOutputCount = response.removed;
      }

      for (const [index, filePath] of selectedFiles.entries()) {
        try {
          const response = await invoke<OcrResponse>("run_ocr", {
            request: {
              input_path: filePath,
              output_dir: settings.outputDir,
              output_format: getOutputFormat(settings),
              ocr_engine: settings.ocrEngine,
              dpi: settings.dpi,
              lang: settings.lang || "ch",
              force_ocr: settings.forceOcr,
            },
          });
          nextResults.push({
            inputPath: filePath,
            outputPath: primaryOutputPath(response),
            txtPath: response.txt_path,
            jsonPath: response.json_path,
            path: primaryOutputPath(response) ?? filePath,
            name: outputFileName(response, filePath),
            status: "success",
            message: "识别完成",
          });
        } catch (error) {
          nextResults.push({
            inputPath: filePath,
            outputPath: null,
            txtPath: null,
            jsonPath: null,
            path: filePath,
            name: fileName(filePath),
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
        setRecognizedFiles([...previousResults, ...nextResults]);
        setProgress({ current: index + 1, total: selectedFiles.length });
      }

      const clearMessage = settings.clearOcrResultsBeforeRun
        ? `，已清理 ${removedOutputCount} 个旧输出文件`
        : "";
      setLog(`本次处理完成: ${nextResults.length} 个文件${clearMessage}。`);
      setProgress(null);
    });
  };

  const runScreenshotOcrPayload = async (imagePath?: string, engine?: OcrEngine, language?: string) => {
    const response = await invoke<ScreenshotOcrResponse>("run_screenshot_ocr", {
      request: {
        image_path: imagePath,
        output_dir: settings.outputDir,
        ocr_engine: engine ?? settings.ocrEngine,
        dpi: settings.dpi,
        lang: language ?? settings.lang,
        force_ocr: settings.forceOcr,
      },
    });

    await invoke("open_ocr_result_window", {
      request: {
        image_path: response.image_path,
        recognized_text: response.recognized_text,
        items: response.items,
        language: response.language,
        engine: response.engine,
        source: response.source,
      },
    }).catch(() => undefined);
    setLog(response.recognized_text ? "截图 OCR 识别完成。" : "截图 OCR 完成，但未识别到文本。");
  };

  const captureScreenshot = async () => {
    await runBusy(async () => {
      const response = await invoke<ScreenshotResponse>("capture_region", {
        request: {
          output_dir: settings.screenshotOutputDir || undefined,
        },
      });
      setScreenshot(response);
      setLog(response.message);
      if (settings.screenshotAutoOcr) {
        await runScreenshotOcrPayload(response.image_path);
      }
    });
  };

  const saveCurrentScreenshot = async () => {
    if (!screenshot) return;
    await runBusy(async () => {
      const response = await invoke<SaveScreenshotResponse>("save_screenshot", {
        request: {
          source_path: screenshot.image_path,
          output_dir: settings.screenshotOutputDir || settings.outputDir || undefined,
        },
      });
      setLog(`截图已保存: ${response.image_path}`);
    });
  };

  const copyCurrentScreenshot = async () => {
    if (!screenshot) return;
    await runBusy(async () => {
      await invoke("copy_screenshot", {
        request: {
          image_path: screenshot.image_path,
        },
      });
      setLog("截图已复制到剪贴板。");
    });
  };

  const runOcrForCurrentScreenshot = async () => {
    if (!screenshot) return;
    await runBusy(async () => {
      await runScreenshotOcrPayload(screenshot.image_path);
    });
  };

  const readCurrentClipboard = async () => {
    await runBusy(async () => {
      const response = await invoke<ClipboardTextResponse>("read_clipboard_text");
      if (response.text.trim()) {
        // 走 write_clipboard_text 让 Rust 统一入库；source=clipboard 表示来自系统剪贴板
        await invoke("write_clipboard_text", {
          request: { text: response.text, source: "clipboard" },
        });
        await loadClipboardHistory();
      }
      setLog(response.text.trim() ? "已读取当前剪贴板文本。" : "当前剪贴板没有文本。");
    });
  };

  const clearClipboardHistory = async () => {
    try {
      await invoke("clear_clipboard_history");
      await loadClipboardHistory();
      setLog("剪贴板历史已清空。");
    } catch (error) {
      setLog(`清空剪贴板历史失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const deleteClipboardItem = async (id: string) => {
    try {
      await invoke("delete_clipboard_item", { id });
      setClipboardHistory((current) => current.filter((item) => item.id !== id));
    } catch (error) {
      setLog(`删除剪贴板记录失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const toggleClipboardPinned = async (id: string, pinned: boolean) => {
    try {
      await invoke("set_clipboard_pinned", { id, pinned });
      setClipboardHistory((current) =>
        current.map((item) => (item.id === id ? { ...item, pinned } : item)),
      );
    } catch (error) {
      setLog(`更新置顶失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const useClipboardItem = async (id: string) => {
    try {
      await invoke("use_clipboard_item", { request: { id } });
      await loadClipboardHistory();
      setLog("已放入系统剪贴板，可直接粘贴。");
    } catch (error) {
      setLog(`使用剪贴板记录失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const title = useMemo(() => {
    if (view === "settings") return "系统设置";
    return "墨识";
  }, [view]);

  return (
    <section className={view === "settings" ? "shell stack-page settings-shell" : "shell stack-page"}>
      <header className="topbar">
        <div>
          <p className="eyebrow">本地识别与快捷工具箱</p>
          <h1>{title}</h1>
        </div>
        <nav className="nav-actions">
          <AppButton active={view === "ocr"} disabled={busy} onClick={() => setView("ocr")}>
            OCR
          </AppButton>
          <AppButton active={view === "clipboard"} disabled={busy} onClick={() => setView("clipboard")}>
            剪贴板
          </AppButton>
          <AppButton active={view === "settings"} disabled={busy} onClick={() => setView("settings")}>
            设置
          </AppButton>
        </nav>
      </header>

      {view === "ocr" && (
        <OcrPage
          busy={busy}
          onChooseFile={chooseFile}
          onChooseFolder={chooseFolder}
          onClearFiles={() => setSelectedFiles([])}
          onRemoveFile={(path) => setSelectedFiles((current) => current.filter((item) => item !== path))}
          onRunOcr={runOcr}
          progress={progress}
          recognizedFiles={recognizedFiles}
          selectedFiles={selectedFiles}
        />
      )}

      {view === "clipboard" && (
        <ClipboardPage
          busy={busy}
          history={clipboardHistory}
          onClear={clearClipboardHistory}
          onDelete={deleteClipboardItem}
          onReadCurrent={readCurrentClipboard}
          onTogglePinned={toggleClipboardPinned}
          onUseItem={useClipboardItem}
        />
      )}

      {view === "settings" && (
        <SettingsPage
          busy={busy}
          extensions={extensions}
          log={log}
          onCheckBackend={checkBackend}
          onChooseOutputDir={chooseOutputDir}
          onChooseScreenshotOutputDir={chooseScreenshotOutputDir}
          onInstallExtension={installExtension}
          onPersistSettings={(nextSettings, immediate) =>
            persistSettings(nextSettings, "设置已自动保存。", immediate)
          }
          onResetSettings={resetSettings}
          onUninstallExtension={uninstallExtension}
          onUpdateSettings={setSettings}
          resolvedTheme={resolvedTheme}
          settings={settings}
          status={status}
        />
      )}

      {confirmDialog}
    </section>
  );
}
