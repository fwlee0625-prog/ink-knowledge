import type { AppSettings, ShortcutBindings } from "../types";
import { clampNumber } from "./format";
import { normalizeOcrLanguage } from "./ocrLanguages";

export const legacySettingsKey = "mac-local-ocr.settings";

/// 默认快捷键。使用 Alt(Option)+Shift 组合，避免与系统常用 Cmd 组合冲突。
/// 字段名与 Rust 侧 ShortcutBindings serde rename 对应，便于直接透传给后端。
export const defaultShortcutBindings: ShortcutBindings = {
  ocr: "Alt+Shift+O",
  screenshot: "Alt+Shift+S",
  screenshotOcr: "Alt+Shift+X",
  translation: "Alt+Shift+T",
  clipboard: "Alt+Shift+V",
  settings: "Alt+Shift+Comma",
};

export const fallbackSettings: AppSettings = {
  outputDir: "",
  ocrEngine: "apple-vision",
  themePreference: "system",
  dpi: 300,
  lang: "ch",
  forceOcr: false,
  outputTxt: true,
  outputJson: false,
  recursionDepth: 1,
  clearOcrResultsBeforeRun: false,
  translationEngine: "openai-compatible",
  translationOpenaiEnabled: true,
  translationVolcEnabled: false,
  translationApiBaseUrl: "",
  translationApiKey: "",
  translationModel: "gpt-4o-mini",
  translationVolcAccessKey: "",
  translationVolcSecretKey: "",
  screenshotOutputDir: "",
  screenshotAutoOcr: false,
  screenshotKeepTemp: true,
  ocrResultAutoCloseOnBlur: true,
  clipboardRecordText: true,
  clipboardHistoryLimit: 100,
  clipboardIgnoreSensitive: true,
  clipboardLayout: "horizontal",
  shortcutBindings: { ...defaultShortcutBindings },
};

/// 校验并补全 ShortcutBindings，缺失或非法字段回落到默认值。
function normalizeShortcutBindings(value: Partial<ShortcutBindings> | undefined): ShortcutBindings {
  const fallback = defaultShortcutBindings;
  return {
    ocr: typeof value?.ocr === "string" ? value.ocr : fallback.ocr,
    screenshot: typeof value?.screenshot === "string" ? value.screenshot : fallback.screenshot,
    screenshotOcr:
      typeof value?.screenshotOcr === "string" ? value.screenshotOcr : fallback.screenshotOcr,
    translation: typeof value?.translation === "string" ? value.translation : fallback.translation,
    clipboard: typeof value?.clipboard === "string" ? value.clipboard : fallback.clipboard,
    settings: typeof value?.settings === "string" ? value.settings : fallback.settings,
  };
}

export function normalizeSavedSettings(value: Partial<AppSettings> | null | undefined): Partial<AppSettings> {
  if (!value || Object.keys(value).length === 0) {
    return {};
  }

  const saved = { ...(value ?? {}) };
  delete (saved as Record<string, unknown>).colorCopyFormat;
  delete (saved as Record<string, unknown>).colorHistoryLimit;
  if (typeof saved.screenshotOutputDir === "string" && saved.screenshotOutputDir.trim() === "") {
    delete saved.screenshotOutputDir;
  }
  if (saved.outputTxt === false && saved.outputJson === false) {
    saved.outputTxt = true;
  }
  if (saved.ocrEngine !== "paddle" && saved.ocrEngine !== "apple-vision") {
    saved.ocrEngine = "apple-vision";
  }
  saved.lang = normalizeOcrLanguage(saved.lang);
  if (
    saved.themePreference !== "system" &&
    saved.themePreference !== "light" &&
    saved.themePreference !== "dark"
  ) {
    saved.themePreference = "system";
  }
  if (typeof saved.recursionDepth === "number") {
    saved.recursionDepth = clampNumber(saved.recursionDepth, 1, 5);
  }
  if (typeof saved.clearOcrResultsBeforeRun !== "boolean") {
    saved.clearOcrResultsBeforeRun = false;
  }
  if (typeof saved.clipboardHistoryLimit === "number") {
    saved.clipboardHistoryLimit = clampNumber(saved.clipboardHistoryLimit, 10, 500);
  }
  if (saved.clipboardLayout !== "horizontal" && saved.clipboardLayout !== "vertical") {
    saved.clipboardLayout = "horizontal";
  }
  if (typeof saved.ocrResultAutoCloseOnBlur !== "boolean") {
    saved.ocrResultAutoCloseOnBlur = true;
  }
  if (saved.translationEngine !== "openai-compatible" && saved.translationEngine !== "volcengine") {
    saved.translationEngine = "openai-compatible";
  }
  if (typeof saved.translationOpenaiEnabled !== "boolean") {
    saved.translationOpenaiEnabled = saved.translationEngine !== "volcengine";
  }
  if (typeof saved.translationVolcEnabled !== "boolean") {
    saved.translationVolcEnabled =
      saved.translationEngine === "volcengine" ||
      Boolean(saved.translationVolcAccessKey || saved.translationVolcSecretKey);
  }

  if (!saved.translationOpenaiEnabled && !saved.translationVolcEnabled) {
    if (saved.translationEngine === "volcengine") {
      saved.translationVolcEnabled = true;
    } else {
      saved.translationOpenaiEnabled = true;
    }
  }
  if (saved.translationOpenaiEnabled && saved.translationVolcEnabled) {
    saved.translationOpenaiEnabled = saved.translationEngine === "openai-compatible";
    saved.translationVolcEnabled = saved.translationEngine === "volcengine";
  }
  if (
    saved.translationEngine === "openai-compatible" &&
    !saved.translationOpenaiEnabled &&
    saved.translationVolcEnabled
  ) {
    saved.translationEngine = "volcengine";
  }
  if (saved.translationEngine === "volcengine" && !saved.translationVolcEnabled && saved.translationOpenaiEnabled) {
    saved.translationEngine = "openai-compatible";
  }
  saved.shortcutBindings = normalizeShortcutBindings(saved.shortcutBindings);
  return saved;
}

export function readLegacySavedSettings(): Partial<AppSettings> {
  try {
    const raw = localStorage.getItem(legacySettingsKey);
    const saved = raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    return normalizeSavedSettings(saved);
  } catch {
    return {};
  }
}

export function clearLegacySavedSettings() {
  try {
    localStorage.removeItem(legacySettingsKey);
  } catch {
    // localStorage 在部分 WebView 场景下可能不可用；迁移失败不影响 SQLite 主存储。
  }
}
