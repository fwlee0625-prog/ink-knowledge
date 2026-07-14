import type { ComponentType, CSSProperties, ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import {
  Blocks,
  Bot,
  CheckCircle2,
  Clipboard,
  Cpu,
  Crop,
  Database,
  FileJson,
  Folder,
  Gauge,
  HardDrive,
  Image,
  Info,
  Keyboard,
  KeyRound,
  Languages,
  LayoutPanelTop,
  Monitor,
  Moon,
  Package,
  RefreshCw,
  RotateCcw,
  ScanText,
  Settings,
  Shield,
  Sun,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  AlertDescription,
  AppSelect,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Separator,
  SecretInput,
  ShortcutInput,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
} from "../../ui";
import { clampNumber, formatBytes } from "../../../lib/format";
import { getOcrEngineLabel, ocrEngineOptions, ocrEngineSettingsDescription } from "../../../lib/ocrEngines";
import { ocrLanguageOptions } from "../../../lib/ocrLanguages";
import { cn } from "../../../lib/utils";
import { useAppUpdate } from "../../../lib/update";
import type {
  AppSettings,
  BackendStatus,
  ClearStorageCacheResponse,
  ClipboardLayout,
  ClipboardCardSize,
  ClipboardVerticalHeight,
  ClipboardWindowWidth,
  ExtensionInfo,
  OcrEngine,
  SettingsCategory,
  StorageUsageResponse,
  ThemePreference,
  TranslationEngine,
} from "../../../types";
import type { ResolvedTheme } from "../../../lib/theme";
import { SettingItem } from "./SettingItem";
import { AppUpdatePanel } from "./AppUpdatePanel";
import { SizeOptionCards } from "./SizeOptionCards";
import type { SizeOption } from "./SizeOptionCards";

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
type Option<TValue extends string> = { icon?: ComponentType<LucideProps>; label: string; value: TValue };

const engineOptions: Array<Option<OcrEngine>> = ocrEngineOptions.map((option) => ({
  ...option,
  icon: option.value === "apple-vision" ? Cpu : Package,
}));

const themeOptions: Array<Option<ThemePreference>> = [
  { icon: Monitor, label: "跟随系统", value: "system" },
  { icon: Sun, label: "浅色", value: "light" },
  { icon: Moon, label: "深色", value: "dark" },
];

const translationEngineOptions: Array<Option<TranslationEngine>> = [
  { icon: Bot, label: "OpenAI 兼容", value: "openai-compatible" },
  { icon: Languages, label: "火山翻译", value: "volcengine" },
];

const clipboardLayoutOptions: Array<Option<ClipboardLayout>> = [
  { icon: LayoutPanelTop, label: "横向", value: "horizontal" },
  { icon: Clipboard, label: "纵向", value: "vertical" },
];

const clipboardWindowWidthOptions: Array<SizeOption<ClipboardWindowWidth>> = [
  { detail: "50% × 440px", label: "小", value: "half" },
  { detail: "1280 × 440px", label: "默认", value: "default" },
  { detail: "100% × 440px", label: "大", value: "full" },
];

const clipboardCardSizeOptions: Array<SizeOption<ClipboardCardSize>> = [
  { detail: "168-204px", label: "小", value: "small" },
  { detail: "210-272px", label: "默认", value: "default" },
  { detail: "300-380px", label: "大", value: "large" },
];

const clipboardVerticalHeightOptions: Array<SizeOption<ClipboardVerticalHeight>> = [
  { detail: "620 × 560px", label: "小", value: "small" },
  { detail: "620 × 720px", label: "默认", value: "default" },
  { detail: "620 × 880px", label: "大", value: "large" },
];

const sections: Array<{
  description: string;
  icon: ComponentType<LucideProps>;
  id: SettingsCategory;
  label: string;
}> = [
  { description: "界面主题和基础偏好", icon: Settings, id: "general", label: "通用" },
  { description: "输出、引擎和 PDF 行为", icon: ScanText, id: "ocr", label: "OCR" },
  { description: "API 和语言偏好", icon: Languages, id: "translation", label: "翻译" },
  { description: "保存目录和 OCR 快捷行为", icon: Crop, id: "screenshot", label: "截图" },
  { description: "文本、图片和文件历史", icon: Clipboard, id: "clipboard", label: "剪贴板" },
  { description: "查看占用并清理缓存", icon: Database, id: "storage", label: "缓存管理" },
  { description: "全局快捷键绑定", icon: Keyboard, id: "shortcuts", label: "快捷键" },
  { description: "状态检查和 OCR 扩展", icon: Blocks, id: "backend", label: "后端与扩展" },
  { description: "版本与权限说明", icon: Info, id: "about", label: "关于" },
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
  const { checkForUpdates, manualError: updateManualError, status: updateStatus } = useAppUpdate();
  const draftSettingsRef = useRef(settings);
  const activeMeta = sections.find((section) => section.id === activeSection) ?? sections[0];

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
    <div className="settings-desktop-grid grid h-full min-h-0 gap-4 bg-background text-foreground">
        <aside className="flex min-h-0 flex-col rounded-xl border border-border/50 bg-background/70 p-2 shadow-sm backdrop-blur-xl max-md:min-h-[260px]">
          <nav className="min-h-0 flex-1 space-y-1 overflow-auto pr-1" aria-label="设置分类">
            {sections.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.id;

              return (
                <button
                  className={cn(
                    "group relative flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-[background,opacity] duration-200 ease-out hover:bg-accent",
                    active && "bg-accent",
                  )}
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  type="button"
                >
                  <span
                    className={cn(
                      "absolute left-0 top-3 h-[calc(100%-24px)] w-[3px] rounded-full bg-transparent",
                      active && "bg-foreground",
                    )}
                  />
                  <Icon className="size-[18px] shrink-0 text-foreground" aria-hidden="true" strokeWidth={1.9} />
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-medium text-foreground">{section.label}</strong>
                  </span>
                </button>
              );
            })}
          </nav>

          <Separator className="my-3" />
          <div className="space-y-2 px-1">
            <div className="flex items-center justify-between rounded-lg px-2 py-2 text-sm text-muted-foreground">
              <span className="truncate" title={`版本 ${updateStatus.currentVersion || "-"}`}>
                版本 {updateStatus.currentVersion || "-"}
              </span>
              <Button
                className="h-8 px-2"
                disabled={updateStatus.state === "checking"}
                onClick={() => void checkForUpdates()}
                variant={updateStatus.state === "update_available" ? "outline" : "ghost"}
              >
                <RefreshCw className={updateStatus.state === "checking" ? "animate-spin" : undefined} />
                {updateStatus.state === "update_available" ? `v${updateStatus.latestVersion}` : "检查"}
              </Button>
            </div>
            <div className="flex items-center justify-between rounded-lg px-2 py-2 text-sm">
              <span className="inline-flex items-center gap-2 text-foreground">
                <Moon className="size-4" />
                深色
              </span>
              <Switch
                checked={settings.themePreference === "dark" || resolvedTheme === "dark"}
                onCheckedChange={(checked) =>
                  updateSettings((current) => ({
                    ...current,
                    themePreference: checked ? "dark" : "light",
                  }))
                }
              />
            </div>
          </div>
        </aside>

        <main className="min-h-0 overflow-auto rounded-xl border border-border/60 bg-card p-6 shadow-sm">
          <div className="mx-auto flex max-w-6xl flex-col gap-8">
            <SectionHeading description={sectionDescription(activeSection, resolvedTheme)} title={activeMeta.label} />

            {activeSection === "general" && (
              <SettingsSection footer={<SettingsActions busy={busy} onResetSettings={onResetSettings} />}>
                <SettingCard title="界面主题">
                  <SettingItem
                    description={`当前实际使用${resolvedTheme === "dark" ? "深色" : "浅色"}界面。`}
                    icon={Monitor}
                    title="界面主题"
                  >
                    <OptionToggleGroup
                      options={themeOptions}
                      value={settings.themePreference}
                      onChange={(themePreference) => updateSettings((current) => ({ ...current, themePreference }))}
                    />
                  </SettingItem>
                </SettingCard>
                <Alert>
                  <Info className="mr-2 inline size-4 align-[-2px]" />
                  <AlertDescription className="inline">设置将在下次启动应用时继续沿用。</AlertDescription>
                </Alert>
              </SettingsSection>
            )}

            {activeSection === "ocr" && (
              <SettingsSection footer={<SettingsActions busy={busy} onResetSettings={onResetSettings} />}>
                <SettingCard title="输出与引擎">
                  <SettingItem description="默认输出 OCR 结果的位置。" icon={Folder} title="存储目录">
                    <div className="grid w-[min(520px,50vw)] grid-cols-[minmax(0,1fr)_auto] gap-2 max-lg:w-full">
                      <Input
                        onChange={(event) => updateSettings((current) => ({ ...current, outputDir: event.target.value }))}
                        placeholder="默认在文稿目录下创建 墨识/OCR"
                        value={settings.outputDir}
                      />
                      <Button onClick={onChooseOutputDir} variant="outline">
                        选择
                      </Button>
                    </div>
                  </SettingItem>
                  <SettingItem description="至少保留一种 OCR 输出格式。" icon={FileJson} title="输出格式">
                    <div className="flex flex-wrap items-center justify-end gap-4">
                      <SwitchRow
                        checked={settings.outputTxt}
                        disabled={settings.outputTxt && !settings.outputJson}
                        label="TXT"
                        onCheckedChange={(checked) =>
                          updateSettings((current) => ({
                            ...current,
                            outputTxt: checked || !current.outputJson,
                          }))
                        }
                      />
                      <SwitchRow
                        checked={settings.outputJson}
                        disabled={settings.outputJson && !settings.outputTxt}
                        label="JSON"
                        onCheckedChange={(checked) =>
                          updateSettings((current) => ({
                            ...current,
                            outputJson: checked || !current.outputTxt,
                          }))
                        }
                      />
                    </div>
                  </SettingItem>
                  <SettingItem description={ocrEngineSettingsDescription} icon={Cpu} title="识别引擎">
                    <OptionToggleGroup
                      disabled={busy}
                      options={engineOptions}
                      value={settings.ocrEngine}
                      onChange={(ocrEngine) => updateSettings((current) => ({ ...current, ocrEngine }))}
                    />
                  </SettingItem>
                </SettingCard>

                <SettingCard title="识别行为">
                  <NumberItem
                    description="用于 PDF 扫描页渲染，数值越高越清晰也越慢。"
                    icon={Gauge}
                    max={600}
                    min={72}
                    onChange={(dpi) => updateSettings((current) => ({ ...current, dpi }))}
                    title="DPI"
                    value={settings.dpi}
                  />
                  <SelectSettingItem
                    description="用于提示 OCR 引擎按对应语言优化识别。"
                    icon={Languages}
                    onChange={(lang) => updateSettings((current) => ({ ...current, lang }))}
                    options={ocrLanguageOptions}
                    title="语言"
                    value={settings.lang}
                  />
                  <NumberItem
                    description="批量选择文件夹时向下扫描的目录层级。"
                    icon={Folder}
                    max={5}
                    min={1}
                    onChange={(recursionDepth) => updateSettings((current) => ({ ...current, recursionDepth }))}
                    title="文件夹递归层级"
                    value={settings.recursionDepth}
                  />
                  <SwitchItem
                    checked={settings.clearOcrResultsBeforeRun}
                    description="重新识别前清空旧结果列表和存储目录顶层 txt/json 输出文件。"
                    icon={RotateCcw}
                    onCheckedChange={(checked) =>
                      updateSettings((current) => ({ ...current, clearOcrResultsBeforeRun: checked }))
                    }
                    title="识别前清空结果"
                  />
                  <SwitchItem
                    checked={settings.forceOcr}
                    description="忽略 PDF 自带文本层，逐页渲染后重新识别。"
                    icon={ScanText}
                    onCheckedChange={(checked) => updateSettings((current) => ({ ...current, forceOcr: checked }))}
                    title="强制 OCR PDF 文本层"
                  />
                </SettingCard>
              </SettingsSection>
            )}

            {activeSection === "translation" && (
              <SettingsSection footer={<SettingsActions busy={busy} onResetSettings={onResetSettings} />}>
                <div className="grid gap-6 2xl:grid-cols-[260px_minmax(0,1fr)]">
                  <Card className="h-fit overflow-hidden">
                    <CardHeader className="p-6">
                      <CardTitle>翻译引擎</CardTitle>
                      <CardDescription>点击查看配置，启用后作为当前唯一引擎。</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2 p-3 pt-0">
                      {translationEngineOptions.map((option) => {
                        const Icon = option.icon ?? Languages;
                        const active = activeTranslationEngine === option.value;
                        const enabled =
                          option.value === "openai-compatible"
                            ? settings.translationOpenaiEnabled
                            : settings.translationVolcEnabled;

                        return (
                          <div
                            aria-label={`查看${option.label}配置`}
                            className={cn(
                              "grid min-h-[72px] w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-transparent px-3 py-3 text-left transition-[background,border-color,opacity] duration-200 ease-out hover:bg-accent",
                              active && "border-border bg-accent",
                            )}
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
                            <span className="flex size-10 items-center justify-center text-foreground">
                              <Icon className="size-5 text-foreground" />
                            </span>
                            <span className="min-w-0">
                              <strong className="block truncate text-sm font-medium text-foreground">{option.label}</strong>
                              <span className="mt-1 block text-sm text-muted-foreground">
                                {enabled ? "当前使用" : "可用配置"}
                              </span>
                            </span>
                            <Button
                              aria-disabled={enabled}
                              className={enabled ? "cursor-default" : ""}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (enabled) {
                                  return;
                                }
                                activateTranslationEngine(option.value);
                              }}
                              size="sm"
                              variant={enabled ? "default" : "outline"}
                            >
                              {enabled ? "使用中" : "启用"}
                            </Button>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>

                  <SettingCard title="引擎配置">
                    {activeTranslationEngine === "openai-compatible" && (
                      <>
                        <TextItem
                          description="例如 https://api.openai.com，或直接填 chat/completions 端点。"
                          icon={Zap}
                          onChange={(translationApiBaseUrl) =>
                            updateSettings((current) => ({ ...current, translationApiBaseUrl }))
                          }
                          placeholder="https://api.openai.com"
                          title="API Base URL"
                          value={settings.translationApiBaseUrl}
                        />
                        <TextItem
                          description="保存到本机 SQLite 设置库。"
                          icon={KeyRound}
                          onChange={(translationApiKey) =>
                            updateSettings((current) => ({ ...current, translationApiKey }))
                          }
                          placeholder="sk-..."
                          title="API Key"
                          type="password"
                          value={settings.translationApiKey}
                        />
                        <TextItem
                          description="默认使用轻量模型。"
                          icon={Bot}
                          onChange={(translationModel) =>
                            updateSettings((current) => ({ ...current, translationModel }))
                          }
                          title="模型"
                          value={settings.translationModel}
                        />
                      </>
                    )}
                    {activeTranslationEngine === "volcengine" && (
                      <>
                        <TextItem
                          description="火山引擎访问密钥 Access Key ID，保存到本机 SQLite 设置库。"
                          icon={KeyRound}
                          onChange={(translationVolcAccessKey) =>
                            updateSettings((current) => ({ ...current, translationVolcAccessKey }))
                          }
                          placeholder="AK..."
                          title="Access Key"
                          value={settings.translationVolcAccessKey}
                        />
                        <TextItem
                          description="火山引擎 Secret Access Key，保存到本机 SQLite 设置库。"
                          icon={Shield}
                          onChange={(translationVolcSecretKey) =>
                            updateSettings((current) => ({ ...current, translationVolcSecretKey }))
                          }
                          placeholder="SK..."
                          title="Secret Key"
                          type="password"
                          value={settings.translationVolcSecretKey}
                        />
                      </>
                    )}
                  </SettingCard>
                </div>
              </SettingsSection>
            )}

            {activeSection === "screenshot" && (
              <SettingsSection footer={<SettingsActions busy={busy} onResetSettings={onResetSettings} />}>
                <SettingCard title="截图">
                  <SettingItem description="默认输出截图结果的位置。" icon={Image} title="截图保存目录">
                    <div className="grid w-[min(520px,50vw)] grid-cols-[minmax(0,1fr)_auto] gap-2 max-lg:w-full">
                      <Input
                        onChange={(event) =>
                          updateSettings((current) => ({ ...current, screenshotOutputDir: event.target.value }))
                        }
                        placeholder="默认在文稿目录下创建 墨识/Screenshots"
                        value={settings.screenshotOutputDir}
                      />
                      <Button onClick={onChooseScreenshotOutputDir} variant="outline">
                        选择
                      </Button>
                    </div>
                  </SettingItem>
                  <SwitchItem
                    checked={settings.screenshotKeepTemp}
                    description="关闭后后续版本会在完成操作后清理临时截图。"
                    icon={HardDrive}
                    onCheckedChange={(checked) =>
                      updateSettings((current) => ({ ...current, screenshotKeepTemp: checked }))
                    }
                    title="保留临时文件"
                  />
                  <SwitchItem
                    checked={settings.ocrResultAutoCloseOnBlur}
                    description="结果窗获得焦点后，点击其他应用或窗口时自动关闭。"
                    icon={Crop}
                    onCheckedChange={(checked) =>
                      updateSettings((current) => ({ ...current, ocrResultAutoCloseOnBlur: checked }))
                    }
                    title="结果窗失焦自动关闭"
                  />
                </SettingCard>
              </SettingsSection>
            )}

            {activeSection === "clipboard" && (
              <SettingsSection footer={<SettingsActions busy={busy} onResetSettings={onResetSettings} />}>
                <SettingCard title="剪贴板">
                  <SwitchItem
                    checked={settings.clipboardRecordText}
                    description="关闭后复制仍会写入系统剪贴板，但不进入历史。"
                    icon={Clipboard}
                    onCheckedChange={(checked) =>
                      updateSettings((current) => ({ ...current, clipboardRecordText: checked }))
                    }
                    title="自动捕获系统复制"
                  />
                  <SettingItem description="控制剪贴板独立窗口和主页面的历史展示方式。" icon={LayoutPanelTop} title="显示样式">
                    <OptionToggleGroup
                      options={clipboardLayoutOptions}
                      value={settings.clipboardLayout}
                      onChange={(clipboardLayout) => updateSettings((current) => ({ ...current, clipboardLayout }))}
                    />
                  </SettingItem>
                  {settings.clipboardLayout === "horizontal" && (
                    <SettingItem description="选择横向窗口的显示宽度。" icon={Monitor} title="横向窗口宽度">
                      <SizeOptionCards
                        options={clipboardWindowWidthOptions}
                        value={settings.clipboardWindowWidth}
                        onChange={(clipboardWindowWidth) =>
                          updateSettings((current) => ({ ...current, clipboardWindowWidth }))
                        }
                      />
                    </SettingItem>
                  )}
                  {settings.clipboardLayout === "horizontal" && (
                    <SettingItem description="调整横向列表中单张卡片的宽度。" icon={Gauge} title="横向卡片尺寸">
                      <SizeOptionCards
                        options={clipboardCardSizeOptions}
                        value={settings.clipboardCardSize}
                        onChange={(clipboardCardSize) =>
                          updateSettings((current) => ({ ...current, clipboardCardSize }))
                        }
                      />
                    </SettingItem>
                  )}
                  {settings.clipboardLayout === "vertical" && (
                    <SettingItem description="超出屏幕时自动适配。" icon={Gauge} title="纵向窗口高度">
                      <SizeOptionCards
                        options={clipboardVerticalHeightOptions}
                        value={settings.clipboardVerticalHeight}
                        onChange={(clipboardVerticalHeight) =>
                          updateSettings((current) => ({ ...current, clipboardVerticalHeight }))
                        }
                      />
                    </SettingItem>
                  )}
                  <NumberItem
                    description="超过上限后保留最新记录，收藏项不受裁剪影响。"
                    icon={Database}
                    max={500}
                    min={10}
                    onChange={(clipboardHistoryLimit) =>
                      updateSettings((current) => ({ ...current, clipboardHistoryLimit }))
                    }
                    title="历史条数上限"
                    value={settings.clipboardHistoryLimit}
                  />
                  <SwitchItem
                    checked={settings.clipboardIgnoreSensitive}
                    description="自动跳过疑似密码、Token 等敏感文本。"
                    icon={Shield}
                    onCheckedChange={(checked) =>
                      updateSettings((current) => ({ ...current, clipboardIgnoreSensitive: checked }))
                    }
                    title="忽略敏感内容"
                  />
                </SettingCard>
              </SettingsSection>
            )}

            {activeSection === "storage" && (
              <SettingsSection>
                <Card className="overflow-hidden">
                  <CardContent className="flex min-h-28 items-center justify-between gap-6 p-6 max-sm:flex-col max-sm:items-start">
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">总占用</span>
                      <strong className="mt-2 block text-3xl font-bold text-foreground">
                        {formatBytes(storageUsage?.total_bytes ?? 0)}
                      </strong>
                      <small className="mt-2 block text-sm text-muted-foreground">
                        {storageUsage ? `统计于 ${formatStorageTimestamp(storageUsage.generated_at)}` : "等待统计"}
                      </small>
                    </div>
                    <Button disabled={storageLoading} onClick={() => loadStorageUsage()}>
                      <RefreshCw />
                      {storageLoading ? "统计中..." : "刷新"}
                    </Button>
                  </CardContent>
                </Card>

                {storageError && (
                  <Alert variant="destructive">
                    <AlertDescription>{storageError}</AlertDescription>
                  </Alert>
                )}
                {storageMessage && (
                  <Alert>
                    <AlertDescription>{storageMessage}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-3">
                  {(storageUsage?.items ?? []).map((item) => (
                    <Card className="overflow-hidden" key={item.id}>
                      <CardContent className="p-0">
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-6 p-6 max-sm:grid-cols-1">
                          <div className="flex min-w-0 gap-3">
                            {cacheSelectionMode && (
                              <input
                                aria-label={`选择清理${item.label}`}
                                checked={selectedCacheIds.includes(item.id)}
                                className="mt-1 size-4 accent-foreground"
                                disabled={storageLoading || !item.exists || item.file_count === 0}
                                onChange={(event) => toggleCacheId(item.id, event.target.checked)}
                                type="checkbox"
                              />
                            )}
                            <div className="min-w-0">
                              <strong className="text-sm font-medium text-foreground">{item.label}</strong>
                              <span className="mt-1 block text-sm text-muted-foreground">{item.description}</span>
                              <small className="mt-3 block truncate text-sm text-muted-foreground" title={item.path}>
                                {item.path || "-"}
                              </small>
                            </div>
                          </div>
                          <div className="text-right max-sm:text-left">
                            <b className="text-xl font-semibold text-foreground">{formatBytes(item.size_bytes)}</b>
                            <span className="mt-2 block text-sm text-muted-foreground">
                              {item.exists ? `${item.file_count} 个文件` : "路径尚未创建"}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {!storageUsage && !storageLoading && !storageError && (
                    <Card>
                      <CardContent className="p-6 text-center text-sm text-muted-foreground">
                        点击刷新查看本机存储占用。
                      </CardContent>
                    </Card>
                  )}
                </div>

                <div className="flex justify-end gap-2">
                  {!cacheSelectionMode ? (
                    <Button
                      disabled={storageLoading || !storageUsage || storageUsage.items.length === 0}
                      onClick={() => {
                        setCacheSelectionMode(true);
                        setStorageError("");
                        setStorageMessage("");
                      }}
                      variant="outline"
                    >
                      清理缓存
                    </Button>
                  ) : (
                    <>
                      <Button
                        disabled={storageLoading}
                        onClick={() => {
                          setCacheSelectionMode(false);
                          setSelectedCacheIds([]);
                          setStorageError("");
                        }}
                        variant="outline"
                      >
                        取消
                      </Button>
                      <Button disabled={storageLoading || selectedCacheIds.length === 0} onClick={clearSelectedCache}>
                        清空已选缓存
                      </Button>
                    </>
                  )}
                </div>
              </SettingsSection>
            )}

            {activeSection === "shortcuts" && (
              <SettingsSection footer={<SettingsActions busy={busy} onResetSettings={onResetSettings} />}>
                <SettingCard title="快捷键">
                  <ShortcutItem
                    description="打开主窗口的 OCR 文件识别页。"
                    icon={ScanText}
                    onChange={(ocr) =>
                      updateSettings((current) => ({
                        ...current,
                        shortcutBindings: { ...current.shortcutBindings, ocr },
                      }))
                    }
                    title="OCR"
                    value={settings.shortcutBindings.ocr}
                  />
                  <ShortcutItem
                    description="启动原生截图浮层，框选后保存为 PNG。"
                    icon={Crop}
                    onChange={(screenshot) =>
                      updateSettings((current) => ({
                        ...current,
                        shortcutBindings: { ...current.shortcutBindings, screenshot },
                      }))
                    }
                    title="截屏"
                    value={settings.shortcutBindings.screenshot}
                  />
                  <ShortcutItem
                    description="启动原生截图浮层，框选后直接送入 OCR 后端。"
                    icon={ScanText}
                    onChange={(screenshotOcr) =>
                      updateSettings((current) => ({
                        ...current,
                        shortcutBindings: { ...current.shortcutBindings, screenshotOcr },
                      }))
                    }
                    title="截图 OCR"
                    value={settings.shortcutBindings.screenshotOcr}
                  />
                  <ShortcutItem
                    description="打开独立翻译弹框。"
                    icon={Languages}
                    onChange={(translation) =>
                      updateSettings((current) => ({
                        ...current,
                        shortcutBindings: { ...current.shortcutBindings, translation },
                      }))
                    }
                    title="翻译"
                    value={settings.shortcutBindings.translation}
                  />
                  <ShortcutItem
                    description="打开主窗口的剪贴板历史页面。"
                    icon={Clipboard}
                    onChange={(clipboard) =>
                      updateSettings((current) => ({
                        ...current,
                        shortcutBindings: { ...current.shortcutBindings, clipboard },
                      }))
                    }
                    title="剪贴板"
                    value={settings.shortcutBindings.clipboard}
                  />
                  <ShortcutItem
                    description="打开主窗口的系统设置页。"
                    icon={Settings}
                    onChange={(settingsValue) =>
                      updateSettings((current) => ({
                        ...current,
                        shortcutBindings: { ...current.shortcutBindings, settings: settingsValue },
                      }))
                    }
                    title="打开设置"
                    value={settings.shortcutBindings.settings}
                  />
                </SettingCard>
              </SettingsSection>
            )}

            {activeSection === "backend" && (
              <SettingsSection>
                <Card className="overflow-hidden">
                  <CardContent className="flex items-center justify-between gap-6 p-6 max-sm:flex-col max-sm:items-start">
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center text-foreground">
                        <CheckCircle2 className="size-5 text-foreground" />
                      </span>
                      <div>
                        <strong className="text-sm font-medium text-foreground">
                          {status?.ready ? "OCR 后端已就绪" : "OCR 后端未就绪"}
                        </strong>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {status?.message ?? "点击检查后端状态"}
                        </span>
                      </div>
                    </div>
                    <Button disabled={busy} onClick={onCheckBackend}>
                      检查后端
                    </Button>
                  </CardContent>
                </Card>

                <div className="grid gap-4 md:grid-cols-2">
                  <MetaCard label="内置后端命令" value={status?.backend_bin ?? "-"} />
                  <MetaCard label="App 数据目录" value={status?.app_data_dir ?? "-"} />
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold text-foreground">OCR 扩展</h2>
                    <p className="mt-1 text-sm text-muted-foreground">导入包含 manifest.json 的本地扩展目录。</p>
                  </div>
                  <Button disabled={busy} onClick={onInstallExtension}>
                    导入扩展
                  </Button>
                </div>

                <div className="space-y-3">
                  {extensions.map((extension) => (
                    <Card className="overflow-hidden" key={extension.id}>
                      <CardContent className="grid min-h-[88px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-6">
                        <div className="min-w-0">
                          <strong className="text-sm font-medium text-foreground">
                            {getOcrEngineLabel(extension.id, extension.name)}
                          </strong>
                          <span className="mt-1 block text-sm text-muted-foreground">
                            {extension.installed ? `版本 ${extension.version ?? "-"}` : extension.message}
                          </span>
                          {extension.entry && (
                            <small className="mt-2 block truncate text-sm text-muted-foreground">{extension.entry}</small>
                          )}
                        </div>
                        {extension.installed ? (
                          <Button
                            disabled={busy}
                            onClick={() => onUninstallExtension(extension.id, getOcrEngineLabel(extension.id, extension.name))}
                            variant="ghost"
                          >
                            卸载
                          </Button>
                        ) : (
                          <Button disabled={busy} onClick={onInstallExtension}>
                            导入
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <pre className="max-h-40 overflow-auto rounded-xl border border-border/60 bg-muted/40 p-4 text-sm text-muted-foreground">
                  {log || "等待操作。"}
                </pre>
              </SettingsSection>
            )}

            {activeSection === "about" && (
              <SettingsSection>
                <div className="grid gap-4 md:grid-cols-3">
                  <MetaCard label="版本" value={updateStatus.currentVersion || "-"} />
                  <MetaCard label="权限说明" value="截图需要 macOS 屏幕录制权限；剪贴板功能会读写系统剪贴板。" />
                  <MetaCard label="翻译说明" value="启用翻译后，文本会发送到你配置的 API 服务。" />
                </div>
                <AppUpdatePanel
                  manualError={updateManualError}
                  onCheckForUpdates={checkForUpdates}
                  status={updateStatus}
                />
              </SettingsSection>
            )}
          </div>
        </main>
    </div>
  );
}

function SectionHeading({ description, title }: { description: string; title: string }) {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-normal text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function SettingsSection({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="flex flex-col gap-8">
      {children}
      {footer}
    </section>
  );
}

function SettingCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-6 pb-4">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <Separator />
      <CardContent className="divide-y divide-border/60 p-0">{children}</CardContent>
    </Card>
  );
}

function SettingsActions({ busy, onResetSettings }: { busy: boolean; onResetSettings: () => Promise<void> }) {
  return (
    <div className="flex justify-end">
      <Button disabled={busy} onClick={onResetSettings}>
        <RotateCcw />
        恢复默认
      </Button>
    </div>
  );
}

function TextItem({
  description,
  icon,
  onChange,
  placeholder,
  title,
  type = "text",
  value,
}: {
  description: string;
  icon: ComponentType<LucideProps>;
  onChange: (value: string) => void;
  placeholder?: string;
  title: string;
  type?: string;
  value: string;
}) {
  const revealable = type === "password";

  return (
    <SettingItem description={description} icon={icon} title={title}>
      {revealable ? (
        <SecretInput
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          value={value}
          wrapperClassName="w-[min(420px,42vw)] max-lg:w-full"
        />
      ) : (
        <Input
          className="w-[min(420px,42vw)] max-lg:w-full"
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          type={type}
          value={value}
        />
      )}
    </SettingItem>
  );
}

function NumberItem({
  description,
  icon,
  max,
  min,
  onChange,
  title,
  value,
}: {
  description: string;
  icon: ComponentType<LucideProps>;
  max: number;
  min: number;
  onChange: (value: number) => void;
  title: string;
  value: number;
}) {
  return (
    <SettingItem description={description} icon={icon} title={title}>
      <Input
        className="w-32"
        max={max}
        min={min}
        onChange={(event) => onChange(clampNumber(Number(event.target.value || min), min, max))}
        type="number"
        value={value}
      />
    </SettingItem>
  );
}

function SelectSettingItem({
  description,
  icon,
  onChange,
  options,
  title,
  value,
}: {
  description: string;
  icon: ComponentType<LucideProps>;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  title: string;
  value: string;
}) {
  return (
    <SettingItem description={description} icon={icon} title={title}>
      <AppSelect
        ariaLabel={title}
        className="w-[min(420px,42vw)] max-lg:w-full"
        onChange={onChange}
        options={options}
        value={value}
      />
    </SettingItem>
  );
}

function SwitchItem({
  checked,
  description,
  icon,
  onCheckedChange,
  title,
}: {
  checked: boolean;
  description: string;
  icon: ComponentType<LucideProps>;
  onCheckedChange: (checked: boolean) => void;
  title: string;
}) {
  return (
    <SettingItem description={description} icon={icon} title={title}>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </SettingItem>
  );
}

function ShortcutItem({
  description,
  icon,
  onChange,
  title,
  value,
}: {
  description: string;
  icon: ComponentType<LucideProps>;
  onChange: (value: string) => void;
  title: string;
  value: string;
}) {
  return (
    <SettingItem description={description} icon={icon} title={title}>
      <ShortcutInput onChange={onChange} value={value} />
    </SettingItem>
  );
}

function SwitchRow({
  checked,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-foreground">
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
      {label}
    </label>
  );
}

function OptionToggleGroup<TValue extends string>({
  disabled = false,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  onChange: (value: TValue) => void;
  options: Array<Option<TValue>>;
  value: TValue;
}) {
  return (
    <ToggleGroup
      className="grid w-[min(520px,50vw)] grid-cols-[repeat(var(--option-count),minmax(0,1fr))] rounded-xl border border-border/60 bg-muted/40 p-1 shadow-sm max-lg:w-full"
      disabled={disabled}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onChange(nextValue as TValue);
        }
      }}
      style={{ "--option-count": options.length } as CSSProperties}
      type="single"
      value={value}
    >
      {options.map((option) => {
        const Icon = option.icon;

        return (
          <ToggleGroupItem
            className="min-w-0 rounded-lg text-muted-foreground hover:bg-background hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm data-[state=on]:hover:bg-primary/90 data-[state=on]:hover:text-primary-foreground"
            key={option.value}
            value={option.value}
          >
            {Icon && <Icon className="size-4" />}
            <span className="truncate">{option.label}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <strong className="mt-2 block break-words text-sm font-medium text-foreground">{value}</strong>
      </CardContent>
    </Card>
  );
}

function formatStorageTimestamp(value: string) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "-";
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function sectionDescription(section: SettingsCategory, resolvedTheme: ResolvedTheme) {
  if (section === "general") return `管理界面主题和应用基础偏好，当前为${resolvedTheme === "dark" ? "深色" : "浅色"}界面。`;
  if (section === "ocr") return "管理 OCR 输出位置、输出格式、引擎和 PDF 扫描行为。";
  if (section === "translation") return "管理当前翻译引擎、密钥和语言偏好。";
  if (section === "screenshot") return "管理截图保存位置、临时文件和截图 OCR 结果窗行为。";
  if (section === "clipboard") return "自动捕获系统复制，支持文本、图片和文件历史。";
  if (section === "storage") return "查看 OCR、截图、剪贴板和模型缓存占用，并按需清理。";
  if (section === "shortcuts") return "全局快捷键在主窗口隐藏时也能触发。";
  if (section === "backend") return "后端管理已归入设置，不再占用一级工具导航。";
  return "墨识是面向 macOS 的本地识别与快捷工具箱。";
}
