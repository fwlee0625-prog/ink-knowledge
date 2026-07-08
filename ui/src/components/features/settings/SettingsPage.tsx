import type { ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import { AppButton, Card, SegmentedControl, ShortcutInput, Toggle } from "../../ui";
import { clampNumber, formatBytes } from "../../../lib/format";
import { defaultShortcutBindings } from "../../../lib/settings";
import type {
  AppSettings,
  BackendStatus,
  ClearStorageCacheResponse,
  ClipboardLayout,
  ExtensionInfo,
  OcrEngine,
  SettingsCategory,
  StorageUsageResponse,
  ThemePreference,
  TranslationEngine,
} from "../../../types";
import type { ResolvedTheme } from "../../../lib/theme";

type SettingsPageProps = {
  busy: boolean;
  extensions: ExtensionInfo[];
  log: string;
  settings: AppSettings;
  status: BackendStatus | null;
  onCheckBackend: () => Promise<void>;
  onChooseOutputDir: () => Promise<void>;
  onChooseScreenshotOutputDir: () => Promise<void>;
  onInstallExtension: () => Promise<void>;
  onResetSettings: () => Promise<void>;
  onPersistSettings: (nextSettings: AppSettings, immediate?: boolean) => void;
  onUninstallExtension: (id: string, name: string) => Promise<void>;
  onUpdateSettings: (nextSettings: AppSettings) => void;
  resolvedTheme: ResolvedTheme;
};

type SettingsUpdater = (current: AppSettings) => AppSettings;

const engineOptions: Array<{ label: string; value: OcrEngine }> = [
  { label: "Apple Vision", value: "apple-vision" },
  { label: "PaddleOCR 扩展", value: "paddle" },
];

const themeOptions: Array<{ label: string; value: ThemePreference }> = [
  { label: "跟随系统", value: "system" },
  { label: "浅色", value: "light" },
  { label: "深色", value: "dark" },
];

const translationEngineOptions: Array<{ label: string; value: TranslationEngine }> = [
  { label: "OpenAI 兼容", value: "openai-compatible" },
  { label: "火山翻译", value: "volcengine" },
];

const clipboardLayoutOptions: Array<{ label: string; value: ClipboardLayout }> = [
  { label: "横向", value: "horizontal" },
  { label: "纵向", value: "vertical" },
];

const sections: Array<{ id: SettingsCategory; label: string; description: string }> = [
  { id: "general", label: "通用", description: "界面主题和基础偏好" },
  { id: "ocr", label: "OCR", description: "输出、引擎和 PDF 行为" },
  { id: "translation", label: "翻译", description: "API 和语言偏好" },
  { id: "screenshot", label: "截图", description: "保存目录和 OCR 快捷行为" },
  { id: "clipboard", label: "剪贴板", description: "文本、图片和文件历史" },
  { id: "storage", label: "缓存管理", description: "查看占用并清理缓存" },
  { id: "shortcuts", label: "快捷键", description: "全局快捷键绑定" },
  { id: "backend", label: "后端与扩展", description: "状态检查和 OCR 扩展" },
  { id: "about", label: "关于", description: "版本与权限说明" },
];

export function SettingsPage({
  busy,
  extensions,
  log,
  settings,
  status,
  onCheckBackend,
  onChooseOutputDir,
  onChooseScreenshotOutputDir,
  onInstallExtension,
  onResetSettings,
  onPersistSettings,
  onUninstallExtension,
  onUpdateSettings,
  resolvedTheme,
}: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsCategory>("general");
  const [activeTranslationEngine, setActiveTranslationEngine] = useState<TranslationEngine>(settings.translationEngine);
  const [storageUsage, setStorageUsage] = useState<StorageUsageResponse | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [storageMessage, setStorageMessage] = useState("");
  const [cacheSelectionMode, setCacheSelectionMode] = useState(false);
  const [selectedCacheIds, setSelectedCacheIds] = useState<string[]>([]);
  const draftSettingsRef = useRef(settings);

  useEffect(() => {
    draftSettingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    setActiveTranslationEngine(settings.translationEngine);
  }, [settings.translationEngine]);

  const updateSettings = (updater: SettingsUpdater, immediate = false) => {
    const nextSettings = updater(draftSettingsRef.current);
    draftSettingsRef.current = nextSettings;
    onUpdateSettings(nextSettings);
    onPersistSettings(nextSettings, immediate);
  };

  const activateTranslationEngine = (translationEngine: TranslationEngine) => {
    setActiveTranslationEngine(translationEngine);
    updateSettings(
      (current) => ({
        ...current,
        translationEngine,
        translationOpenaiEnabled: translationEngine === "openai-compatible",
        translationVolcEnabled: translationEngine === "volcengine",
      }),
      true,
    );
  };

  const saveDraftSettings = () => {
    onPersistSettings(draftSettingsRef.current, true);
  };

  const loadStorageUsage = async (preserveMessage = false) => {
    setStorageLoading(true);
    setStorageError("");
    if (!preserveMessage) {
      setStorageMessage("");
    }
    try {
      const response = await invoke<StorageUsageResponse>("get_storage_usage", {
        request: {
          output_dir: settings.outputDir || undefined,
          screenshot_output_dir: settings.screenshotOutputDir || undefined,
        },
      });
      setStorageUsage(response);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setStorageLoading(false);
    }
  };

  const toggleCacheId = (id: string, checked: boolean) => {
    setSelectedCacheIds((current) =>
      checked ? Array.from(new Set([...current, id])) : current.filter((item) => item !== id),
    );
  };

  const clearSelectedCache = async () => {
    if (selectedCacheIds.length === 0) {
      setStorageError("请先选择要清理的缓存。");
      return;
    }

    setStorageLoading(true);
    setStorageError("");
    setStorageMessage("");
    try {
      const response = await invoke<ClearStorageCacheResponse>("clear_storage_cache", {
        request: {
          ids: selectedCacheIds,
          output_dir: settings.outputDir || undefined,
          screenshot_output_dir: settings.screenshotOutputDir || undefined,
        },
      });
      setStorageMessage(`已清理 ${response.cleared_ids.length} 项，释放 ${formatBytes(response.removed_bytes)}。`);
      setSelectedCacheIds([]);
      setCacheSelectionMode(false);
      await loadStorageUsage(true);
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error));
    } finally {
      setStorageLoading(false);
    }
  };

  useEffect(() => {
    if (activeSection === "storage") {
      void loadStorageUsage();
    }
  }, [activeSection, settings.outputDir, settings.screenshotOutputDir]);

  return (
    <Card className="settings-panel settings-layout" variant="page">
      <aside className="settings-sidebar" aria-label="设置分类">
        {sections.map((section) => (
          <button
            className={activeSection === section.id ? "settings-nav-button active" : "settings-nav-button"}
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            type="button"
          >
            <strong>{section.label}</strong>
            <span>{section.description}</span>
          </button>
        ))}
      </aside>

      <div className="settings-content" onBlurCapture={saveDraftSettings}>
        {activeSection === "general" && (
          <SettingsSection
            description="管理界面主题和应用基础偏好。"
            footer={<SettingsActions busy={busy} onResetSettings={onResetSettings} />}
            title="通用"
          >
            <div className="settings-list">
              <SettingRow
                description={`当前实际使用${resolvedTheme === "dark" ? "深色" : "浅色"}界面。`}
                label="界面主题"
              >
                <SegmentedControl
                  onChange={(themePreference) => updateSettings((current) => ({ ...current, themePreference }))}
                  options={themeOptions}
                  value={settings.themePreference}
                />
              </SettingRow>
            </div>
          </SettingsSection>
        )}

        {activeSection === "ocr" && (
          <SettingsSection
            description="管理 OCR 输出位置、输出格式、引擎和 PDF 扫描行为。"
            footer={<SettingsActions busy={busy} onResetSettings={onResetSettings} />}
            title="OCR"
          >
            <div className="settings-list">
              <SettingRow description="默认输出 OCR 结果的位置。" label="存储目录">
                <div className="file-row">
                  <input
                    onChange={(event) => updateSettings((current) => ({ ...current, outputDir: event.target.value }))}
                    placeholder="默认在文稿目录下创建 墨识/OCR"
                    value={settings.outputDir}
                  />
                  <AppButton onClick={onChooseOutputDir}>选择</AppButton>
                </div>
              </SettingRow>
              <SettingRow description="至少保留一种 OCR 输出格式。" label="输出格式">
                <div className="check-row">
                  <Toggle
                    checked={settings.outputTxt}
                    disabled={settings.outputTxt && !settings.outputJson}
                    onChange={(event) =>
                      updateSettings((current) => ({
                        ...current,
                        outputTxt: event.target.checked || !current.outputJson,
                      }))
                    }
                  >
                    TXT
                  </Toggle>
                  <Toggle
                    checked={settings.outputJson}
                    disabled={settings.outputJson && !settings.outputTxt}
                    onChange={(event) =>
                      updateSettings((current) => ({
                        ...current,
                        outputJson: event.target.checked || !current.outputTxt,
                      }))
                    }
                  >
                    JSON
                  </Toggle>
                </div>
              </SettingRow>
              <SettingRow description="Apple Vision 内置可用，PaddleOCR 需先安装扩展。" label="识别引擎">
                <SegmentedControl
                  disabled={busy}
                  onChange={(ocrEngine) => updateSettings((current) => ({ ...current, ocrEngine }))}
                  options={engineOptions}
                  value={settings.ocrEngine}
                />
              </SettingRow>
              <NumberRow
                description="用于 PDF 扫描页渲染，数值越高越清晰也越慢。"
                label="DPI"
                max={600}
                min={72}
                onChange={(dpi) => updateSettings((current) => ({ ...current, dpi }))}
                value={settings.dpi}
              />
              <SettingRow description="支持 ch、en、zh-Hans、zh-Hant 等语言代码。" label="语言">
                <input
                  onChange={(event) => updateSettings((current) => ({ ...current, lang: event.target.value }))}
                  value={settings.lang}
                />
              </SettingRow>
              <NumberRow
                description="批量选择文件夹时向下扫描的目录层级。"
                label="文件夹递归层级"
                max={5}
                min={1}
                onChange={(recursionDepth) => updateSettings((current) => ({ ...current, recursionDepth }))}
                value={settings.recursionDepth}
              />
              <SettingRow description="重新识别时先清空旧的识别文件结果列表，并删除存储目录顶层的 txt/json 输出文件；关闭后会保留旧结果并追加本次结果。" label="识别前清空结果">
                <Toggle
                  checked={settings.clearOcrResultsBeforeRun}
                  onChange={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      clearOcrResultsBeforeRun: event.target.checked,
                    }))
                  }
                >
                  启用
                </Toggle>
              </SettingRow>
              <SettingRow description="忽略 PDF 自带文本层，逐页渲染后重新识别。" label="强制 OCR PDF 文本层">
                <Toggle
                  checked={settings.forceOcr}
                  onChange={(event) => updateSettings((current) => ({ ...current, forceOcr: event.target.checked }))}
                >
                  启用
                </Toggle>
              </SettingRow>
            </div>
          </SettingsSection>
        )}

        {activeSection === "translation" && (
          <SettingsSection
            description="管理当前翻译引擎、密钥和语言偏好。"
            footer={<SettingsActions busy={busy} onResetSettings={onResetSettings} />}
            title="翻译"
          >
            <div className="translation-settings-grid">
              <div className="translation-engine-list" aria-label="翻译引擎">
                {translationEngineOptions.map((option) => {
                  const active = activeTranslationEngine === option.value;
                  const enabled =
                    option.value === "openai-compatible"
                      ? settings.translationOpenaiEnabled
                      : settings.translationVolcEnabled;

                  const cardClassName = [
                    "translation-engine-card",
                    active ? "active" : "",
                    enabled ? "current" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <div
                      aria-label={`查看${option.label}配置`}
                      className={cardClassName}
                      key={option.value}
                      onClick={() => setActiveTranslationEngine(option.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setActiveTranslationEngine(option.value);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="translation-engine-mark">{option.value === "volcengine" ? "火" : "AI"}</span>
                      <span>
                        <strong>{option.label}</strong>
                      </span>
                      <button
                        className="translation-engine-action"
                        disabled={enabled}
                        onClick={(event) => {
                          event.stopPropagation();
                          activateTranslationEngine(option.value);
                        }}
                        type="button"
                      >
                        {enabled ? "使用中" : "启用"}
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="settings-list translation-config-list">
                {activeTranslationEngine === "openai-compatible" && (
                  <>
                    <TextRow
                      description="例如 https://api.openai.com，或直接填 chat/completions 端点。"
                      label="API Base URL"
                      onChange={(translationApiBaseUrl) =>
                        updateSettings((current) => ({ ...current, translationApiBaseUrl }))
                      }
                      placeholder="https://api.openai.com"
                      value={settings.translationApiBaseUrl}
                    />
                    <TextRow
                      description="保存到本机 SQLite 设置库。"
                      label="API Key"
                      onChange={(translationApiKey) =>
                        updateSettings((current) => ({ ...current, translationApiKey }))
                      }
                      placeholder="sk-..."
                      type="password"
                      value={settings.translationApiKey}
                    />
                    <TextRow
                      description="默认使用轻量模型。"
                      label="模型"
                      onChange={(translationModel) =>
                        updateSettings((current) => ({ ...current, translationModel }))
                      }
                      value={settings.translationModel}
                    />
                  </>
                )}
                {activeTranslationEngine === "volcengine" && (
                  <>
                    <TextRow
                      description="火山引擎访问密钥 Access Key ID，保存到本机 SQLite 设置库。"
                      label="Access Key"
                      onChange={(translationVolcAccessKey) =>
                        updateSettings((current) => ({ ...current, translationVolcAccessKey }))
                      }
                      placeholder="AK..."
                      value={settings.translationVolcAccessKey}
                    />
                    <TextRow
                      description="火山引擎 Secret Access Key，保存到本机 SQLite 设置库。"
                      label="Secret Key"
                      onChange={(translationVolcSecretKey) =>
                        updateSettings((current) => ({ ...current, translationVolcSecretKey }))
                      }
                      placeholder="SK..."
                      type="password"
                      value={settings.translationVolcSecretKey}
                    />
                  </>
                )}
                <SettingRow description="简体中文自动译为英文，其他语言自动译为简体中文。" label="语言方向">
                  <strong className="setting-static-value">自动判断</strong>
                </SettingRow>
              </div>
            </div>
          </SettingsSection>
        )}

        {activeSection === "screenshot" && (
          <SettingsSection
            description="截图和截图 OCR 是两个独立工具，普通截图可通过按钮快捷识别。"
            footer={<SettingsActions busy={busy} onResetSettings={onResetSettings} />}
            title="截图"
          >
            <div className="settings-list">
              <SettingRow description="默认输出截图结果的位置。" label="截图保存目录">
                <div className="file-row">
                  <input
                    onChange={(event) =>
                      updateSettings((current) => ({ ...current, screenshotOutputDir: event.target.value }))
                    }
                    placeholder="默认在文稿目录下创建 墨识/Screenshots"
                    value={settings.screenshotOutputDir}
                  />
                  <AppButton onClick={onChooseScreenshotOutputDir}>选择</AppButton>
                </div>
              </SettingRow>
              <SettingRow description="普通截图后是否自动打开 OCR；默认关闭，使用工具栏 OCR 按钮。" label="截图后自动 OCR">
                <Toggle
                  checked={settings.screenshotAutoOcr}
                  onChange={(event) =>
                    updateSettings((current) => ({ ...current, screenshotAutoOcr: event.target.checked }))
                  }
                >
                  启用
                </Toggle>
              </SettingRow>
              <SettingRow description="关闭后后续版本会在完成操作后清理临时截图。" label="保留临时文件">
                <Toggle
                  checked={settings.screenshotKeepTemp}
                  onChange={(event) =>
                    updateSettings((current) => ({ ...current, screenshotKeepTemp: event.target.checked }))
                  }
                >
                  保留
                </Toggle>
              </SettingRow>
              <SettingRow description="结果窗获得焦点后，点击其他应用或窗口时自动关闭；默认开启。" label="结果窗失焦自动关闭">
                <Toggle
                  checked={settings.ocrResultAutoCloseOnBlur}
                  onChange={(event) =>
                    updateSettings((current) => ({
                      ...current,
                      ocrResultAutoCloseOnBlur: event.target.checked,
                    }))
                  }
                >
                  启用
                </Toggle>
              </SettingRow>
            </div>
          </SettingsSection>
        )}

        {activeSection === "clipboard" && (
          <SettingsSection
            description="自动捕获系统复制，支持文本、图片和文件（文件仅存路径）。"
            footer={<SettingsActions busy={busy} onResetSettings={onResetSettings} />}
            title="剪贴板"
          >
            <div className="settings-list">
              <SettingRow description="关闭后复制仍会写入系统剪贴板，但不进入历史。" label="自动捕获系统复制">
                <Toggle
                  checked={settings.clipboardRecordText}
                  onChange={(event) =>
                    updateSettings((current) => ({ ...current, clipboardRecordText: event.target.checked }))
                  }
                >
                  启用
                </Toggle>
              </SettingRow>
              <SettingRow description="控制剪贴板独立窗口和主页面的历史展示方式。" label="显示样式">
                <SegmentedControl
                  onChange={(clipboardLayout) =>
                    updateSettings((current) => ({ ...current, clipboardLayout }))
                  }
                  options={clipboardLayoutOptions}
                  value={settings.clipboardLayout}
                />
              </SettingRow>
              <NumberRow
                description="超过上限后保留最新记录，置顶项不受裁剪影响。"
                label="历史条数上限"
                max={500}
                min={10}
                onChange={(clipboardHistoryLimit) =>
                  updateSettings((current) => ({ ...current, clipboardHistoryLimit }))
                }
                value={settings.clipboardHistoryLimit}
              />
              <SettingRow description="自动跳过疑似密码、Token 等敏感文本。" label="忽略敏感内容">
                <Toggle
                  checked={settings.clipboardIgnoreSensitive}
                  onChange={(event) =>
                    updateSettings((current) => ({ ...current, clipboardIgnoreSensitive: event.target.checked }))
                  }
                >
                  启用
                </Toggle>
              </SettingRow>
            </div>
          </SettingsSection>
        )}

        {activeSection === "storage" && (
          <SettingsSection
            description="查看 OCR、截图、剪贴板和模型缓存占用，并按需清理。"
            title="缓存管理"
          >
            <div className="storage-summary">
              <div>
                <span>总占用</span>
                <strong>{formatBytes(storageUsage?.total_bytes ?? 0)}</strong>
                <small>
                  {storageUsage ? `统计于 ${formatStorageTimestamp(storageUsage.generated_at)}` : "等待统计"}
                </small>
              </div>
              <AppButton disabled={storageLoading} onClick={() => loadStorageUsage()} variant="primary">
                {storageLoading ? "统计中..." : "刷新"}
              </AppButton>
            </div>
            {storageError && <div className="storage-error">{storageError}</div>}
            {storageMessage && <div className="storage-message">{storageMessage}</div>}
            <div className="storage-list">
              {(storageUsage?.items ?? []).map((item) => (
                <article className="storage-item" key={item.id}>
                  <div className="storage-item-main">
                    <div className="storage-item-title">
                      {cacheSelectionMode && (
                        <input
                          aria-label={`选择清理${item.label}`}
                          checked={selectedCacheIds.includes(item.id)}
                          disabled={storageLoading || !item.exists || item.file_count === 0}
                          onChange={(event) => toggleCacheId(item.id, event.target.checked)}
                          type="checkbox"
                        />
                      )}
                      <strong>{item.label}</strong>
                      <span>{item.description}</span>
                    </div>
                    <b>{formatBytes(item.size_bytes)}</b>
                  </div>
                  <div className="storage-item-meta">
                    <span>{item.exists ? `${item.file_count} 个文件` : "路径尚未创建"}</span>
                    <small title={item.path}>{item.path || "-"}</small>
                  </div>
                </article>
              ))}
              {!storageUsage && !storageLoading && !storageError && (
                <div className="storage-empty">点击刷新查看本机存储占用。</div>
              )}
            </div>
            <div className="storage-actions">
              {!cacheSelectionMode ? (
                <AppButton
                  disabled={storageLoading || !storageUsage || storageUsage.items.length === 0}
                  onClick={() => {
                    setCacheSelectionMode(true);
                    setStorageError("");
                    setStorageMessage("");
                  }}
                >
                  清理缓存
                </AppButton>
              ) : (
                <>
                  <AppButton
                    disabled={storageLoading}
                    onClick={() => {
                      setCacheSelectionMode(false);
                      setSelectedCacheIds([]);
                      setStorageError("");
                    }}
                  >
                    取消
                  </AppButton>
                  <AppButton
                    disabled={storageLoading || selectedCacheIds.length === 0}
                    onClick={clearSelectedCache}
                    variant="primary"
                  >
                    清空已选缓存
                  </AppButton>
                </>
              )}
            </div>
          </SettingsSection>
        )}

        {activeSection === "shortcuts" && (
          <SettingsSection
            description="全局快捷键在主窗口隐藏时也能触发。点击输入框后按下组合键即可绑定；按 Esc 取消，按 Backspace 清除。"
            footer={<SettingsActions busy={busy} onResetSettings={onResetSettings} />}
            title="快捷键"
          >
            <div className="settings-list">
              <ShortcutRow
                description="打开主窗口的 OCR 文件识别页。"
                label="OCR"
                onChange={(ocr) =>
                  updateSettings((current) => ({
                    ...current,
                    shortcutBindings: { ...current.shortcutBindings, ocr },
                  }))
                }
                value={settings.shortcutBindings.ocr}
              />
              <ShortcutRow
                description="启动原生截图浮层，框选后保存为 PNG。"
                label="截屏"
                onChange={(screenshot) =>
                  updateSettings((current) => ({
                    ...current,
                    shortcutBindings: { ...current.shortcutBindings, screenshot },
                  }))
                }
                value={settings.shortcutBindings.screenshot}
              />
              <ShortcutRow
                description="启动原生截图浮层，框选后直接送入 OCR 后端。"
                label="截图 OCR"
                onChange={(screenshotOcr) =>
                  updateSettings((current) => ({
                    ...current,
                    shortcutBindings: { ...current.shortcutBindings, screenshotOcr },
                  }))
                }
                value={settings.shortcutBindings.screenshotOcr}
              />
              <ShortcutRow
                description="打开独立翻译弹框。"
                label="翻译"
                onChange={(translation) =>
                  updateSettings((current) => ({
                    ...current,
                    shortcutBindings: { ...current.shortcutBindings, translation },
                  }))
                }
                value={settings.shortcutBindings.translation}
              />
              <ShortcutRow
                description="打开主窗口的剪贴板历史页面。"
                label="剪贴板"
                onChange={(clipboard) =>
                  updateSettings((current) => ({
                    ...current,
                    shortcutBindings: { ...current.shortcutBindings, clipboard },
                  }))
                }
                value={settings.shortcutBindings.clipboard}
              />
              <ShortcutRow
                description="打开主窗口的系统设置页。"
                label="打开设置"
                onChange={(settingsValue) =>
                  updateSettings((current) => ({
                    ...current,
                    shortcutBindings: { ...current.shortcutBindings, settings: settingsValue },
                  }))
                }
                value={settings.shortcutBindings.settings}
              />
              <div className="setting-row shortcuts-hint-row">
                <div className="setting-row-copy">
                  <strong>恢复默认快捷键</strong>
                  <span>把上方所有绑定重置为默认值。</span>
                </div>
                <div className="setting-row-control">
                  <AppButton
                    onClick={() =>
                      updateSettings((current) => ({
                        ...current,
                        shortcutBindings: { ...defaultShortcutBindings },
                      }), true)
                    }
                  >
                    重置快捷键
                  </AppButton>
                </div>
              </div>
            </div>
          </SettingsSection>
        )}

        {activeSection === "backend" && (
          <SettingsSection description="后端管理已归入设置，不再占用一级工具导航。" title="后端与扩展">
            <div className={status?.ready ? "ready status" : "pending status"}>
              <div>
                <strong>{status?.ready ? "OCR 后端已就绪" : "OCR 后端未就绪"}</strong>
                <span>{status?.message ?? "点击检查后端状态"}</span>
              </div>
              <div className="button-row">
                <AppButton disabled={busy} onClick={onCheckBackend} variant="primary">
                  检查后端
                </AppButton>
              </div>
            </div>
            <div className="backend-meta">
              <div>
                <span>内置后端命令</span>
                <strong>{status?.backend_bin ?? "-"}</strong>
              </div>
              <div>
                <span>App 数据目录</span>
                <strong>{status?.app_data_dir ?? "-"}</strong>
              </div>
            </div>
            <div className="section-head">
              <div>
                <strong>OCR 扩展</strong>
                <span>导入包含 manifest.json 的本地扩展目录。</span>
              </div>
              <AppButton disabled={busy} onClick={onInstallExtension} variant="primary">
                导入扩展
              </AppButton>
            </div>
            <div className="extension-list">
              {extensions.map((extension) => (
                <article
                  className={extension.installed ? "extension-card installed" : "extension-card"}
                  key={extension.id}
                >
                  <div>
                    <strong>{extension.name}</strong>
                    <span>{extension.installed ? `版本 ${extension.version ?? "-"}` : extension.message}</span>
                    {extension.entry && <small>{extension.entry}</small>}
                  </div>
                  {extension.installed ? (
                    <AppButton
                      disabled={busy}
                      onClick={() => onUninstallExtension(extension.id, extension.name)}
                      variant="text"
                    >
                      卸载
                    </AppButton>
                  ) : (
                    <AppButton disabled={busy} onClick={onInstallExtension} variant="primary">
                      导入
                    </AppButton>
                  )}
                </article>
              ))}
            </div>
            <pre className="log-box">{log || "等待操作。"}</pre>
          </SettingsSection>
        )}

        {activeSection === "about" && (
          <SettingsSection description="墨识是面向 macOS 的本地识别与快捷工具箱。" title="关于">
            <div className="about-grid">
              <div>
                <strong>版本</strong>
                <span>0.1.0</span>
              </div>
              <div>
                <strong>权限说明</strong>
                <span>截图需要 macOS 屏幕录制权限；剪贴板功能会读写系统剪贴板。</span>
              </div>
              <div>
                <strong>翻译说明</strong>
                <span>启用翻译后，文本会发送到你配置的 API 服务。</span>
              </div>
            </div>
          </SettingsSection>
        )}
      </div>
    </Card>
  );
}

function SettingsSection({
  children,
  description,
  footer,
  title,
}: {
  children: ReactNode;
  description: string;
  footer?: ReactNode;
  title: string;
}) {
  return (
    <section className="settings-section">
      <div className="settings-scroll">
        <SectionTitle description={description} title={title} />
        {children}
      </div>
      {footer}
    </section>
  );
}

function SectionTitle({ description, title }: { description: string; title: string }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      <span>{description}</span>
    </div>
  );
}

function SettingsActions({
  busy,
  onResetSettings,
}: {
  busy: boolean;
  onResetSettings: () => Promise<void>;
}) {
  return (
    <div className="button-row settings-actions">
      <AppButton disabled={busy} onClick={onResetSettings}>
        恢复默认
      </AppButton>
    </div>
  );
}

function TextRow({
  description,
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  description: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  return (
    <SettingRow description={description} label={label}>
      <input
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </SettingRow>
  );
}

function NumberRow({
  description,
  label,
  max,
  min,
  onChange,
  value,
}: {
  description: string;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <SettingRow description={description} label={label}>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(clampNumber(Number(event.target.value || min), min, max))}
        type="number"
        value={value}
      />
    </SettingRow>
  );
}

function ShortcutRow({
  description,
  label,
  onChange,
  value,
}: {
  description: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <SettingRow description={description} label={label}>
      <ShortcutInput onChange={onChange} value={value} />
    </SettingRow>
  );
}

function formatStorageTimestamp(value: string) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "-";
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function SettingRow({
  children,
  description,
  label,
}: {
  children: ReactNode;
  description: string;
  label: string;
}) {
  return (
    <div className="setting-row">
      <div className="setting-row-copy">
        <strong>{label}</strong>
        <span>{description}</span>
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}
