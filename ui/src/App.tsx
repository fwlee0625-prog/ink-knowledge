import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OcrPage } from "./components/features/ocr/OcrPage";
import { SettingsPage } from "./components/features/settings/SettingsPage";
import { AppButton, useConfirmDialog } from "./components/ui";
import { clampNumber, fileName, getOutputFormat, outputFileName, primaryOutputPath } from "./lib/format";
import { fallbackSettings, readSavedSettings, settingsKey } from "./lib/settings";
import type {
  AppSettings,
  BackendStatus,
  DefaultSettings,
  ExtensionInfo,
  OcrResponse,
  RecognitionFile,
  RecognitionProgress,
  View,
} from "./types";

export function App() {
  const [view, setView] = useState<View>("ocr");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [settings, setSettings] = useState<AppSettings>(fallbackSettings);
  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [recognizedFiles, setRecognizedFiles] = useState<RecognitionFile[]>([]);
  const [progress, setProgress] = useState<RecognitionProgress>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

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

  const loadDefaultSettings = useCallback(async () => {
    const defaults = await invoke<DefaultSettings>("get_default_settings");
    const baseSettings: AppSettings = {
      outputDir: defaults.output_dir,
      ocrEngine: defaults.ocr_engine,
      dpi: defaults.dpi,
      lang: defaults.lang,
      forceOcr: defaults.force_ocr,
      outputTxt: defaults.output_txt,
      outputJson: defaults.output_json,
      recursionDepth: defaults.recursion_depth,
    };

    const saved = readSavedSettings();
    const nextSettings = { ...baseSettings, ...saved };
    nextSettings.recursionDepth = clampNumber(nextSettings.recursionDepth, 1, 5);
    setSettings(nextSettings);
  }, []);

  useEffect(() => {
    void loadDefaultSettings();
  }, [loadDefaultSettings]);

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

  const chooseOutputDir = async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: true,
      });

      if (typeof selected === "string") {
        setSettings((current) => ({ ...current, outputDir: selected }));
        setLog(`已选择存储目录: ${selected}`);
      }
    } catch (error) {
      setLog(`选择存储目录失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const saveSettings = () => {
    if (!settings.outputTxt && !settings.outputJson) {
      setLog("请至少选择一种输出格式。");
      return;
    }
    localStorage.setItem(settingsKey, JSON.stringify(settings));
    setLog("设置已保存。");
  };

  const resetSettings = async () => {
    await runBusy(async () => {
      localStorage.removeItem(settingsKey);
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
      setRecognizedFiles([]);
      setProgress({ current: 0, total: selectedFiles.length });

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
        setRecognizedFiles([...nextResults]);
        setProgress({ current: index + 1, total: selectedFiles.length });
      }

      setLog(`本次处理完成: ${nextResults.length} 个文件。`);
      setProgress(null);
    });
  };

  const title = useMemo(() => {
    if (view === "settings") return "系统设置";
    return "墨识 OCR";
  }, [view]);

  return (
    <section className={view === "settings" ? "shell stack-page settings-shell" : "shell stack-page"}>
      <header className="topbar">
        <div>
          <h1>{title}</h1>
        </div>
        <nav className="nav-actions">
          <AppButton active={view === "ocr"} disabled={busy} onClick={() => setView("ocr")}>
            识别
          </AppButton>
          <AppButton active={view === "settings"} disabled={busy} onClick={() => setView("settings")}>
            系统设置
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

      {view === "settings" && (
        <SettingsPage
          busy={busy}
          extensions={extensions}
          log={log}
          onCheckBackend={checkBackend}
          onChooseOutputDir={chooseOutputDir}
          onInstallExtension={installExtension}
          onResetSettings={resetSettings}
          onSaveSettings={saveSettings}
          onUninstallExtension={uninstallExtension}
          onUpdateSettings={setSettings}
          settings={settings}
          status={status}
        />
      )}

      {confirmDialog}
    </section>
  );
}
