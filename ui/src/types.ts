export type BackendStatus = {
  ready: boolean;
  backend_bin: string | null;
  app_data_dir: string;
  message: string;
};

export type ExtensionInfo = {
  id: string;
  name: string;
  version: string | null;
  installed: boolean;
  install_dir: string | null;
  entry: string | null;
  message: string;
};

export type OcrItem = {
  page: number;
  text: string;
  source: string;
  score: number | null;
  box: number[] | null;
  polygon: number[][] | null;
};

export type OcrPayload = {
  input: string;
  items: OcrItem[];
  text: string;
};

export type OcrResponse = {
  json_path: string | null;
  txt_path: string | null;
  payload: OcrPayload;
  stdout: string;
};

export type ClearOcrOutputResponse = {
  removed: number;
};

export type ResultPreview = {
  path: string;
  name: string;
  extension: string;
  content: string;
  size: number;
  truncated: boolean;
};

export type OcrEngine = "paddle" | "apple-vision";

export type ThemePreference = "system" | "light" | "dark";

export type ColorCopyFormat = "hex" | "rgb" | "hsl";

export type TranslationEngine = "openai-compatible" | "volcengine";

/// 全局快捷键绑定。字段名与 Rust 侧 ShortcutBindings serde rename 一致。
/// 空字符串表示该功能不绑定快捷键。
export type ShortcutBindings = {
  ocr: string;
  screenshot: string;
  screenshotOcr: string;
  translation: string;
  clipboard: string;
  color: string;
  settings: string;
};

export type AppSettings = {
  outputDir: string;
  ocrEngine: OcrEngine;
  themePreference: ThemePreference;
  dpi: number;
  lang: string;
  forceOcr: boolean;
  outputTxt: boolean;
  outputJson: boolean;
  recursionDepth: number;
  clearOcrResultsBeforeRun: boolean;
  translationEngine: TranslationEngine;
  translationOpenaiEnabled: boolean;
  translationVolcEnabled: boolean;
  translationApiBaseUrl: string;
  translationApiKey: string;
  translationModel: string;
  translationVolcAccessKey: string;
  translationVolcSecretKey: string;
  screenshotOutputDir: string;
  screenshotAutoOcr: boolean;
  screenshotKeepTemp: boolean;
  ocrResultAutoCloseOnBlur: boolean;
  clipboardRecordText: boolean;
  clipboardHistoryLimit: number;
  clipboardIgnoreSensitive: boolean;
  colorCopyFormat: ColorCopyFormat;
  colorHistoryLimit: number;
  shortcutBindings: ShortcutBindings;
};

export type DefaultSettings = {
  output_dir: string;
  ocr_engine: OcrEngine;
  dpi: number;
  lang: string;
  force_ocr: boolean;
  output_txt: boolean;
  output_json: boolean;
  recursion_depth: number;
};

export type View = "ocr" | "translate" | "clipboard" | "color" | "settings";

export type SettingsCategory =
  | "general"
  | "ocr"
  | "translation"
  | "screenshot"
  | "clipboard"
  | "color"
  | "shortcuts"
  | "backend"
  | "about";

export type RecognitionFile = {
  inputPath: string;
  outputPath: string | null;
  txtPath: string | null;
  jsonPath: string | null;
  path: string;
  name: string;
  status: "success" | "error";
  message: string;
};

export type RecognitionProgress = {
  current: number;
  total: number;
} | null;

export type ScreenshotResponse = {
  image_path: string;
  file_name: string;
  message: string;
};

export type SaveScreenshotResponse = {
  image_path: string;
  file_name: string;
};

export type ScreenshotOcrResponse = {
  image_path: string;
  file_name: string;
  recognized_text: string;
  items: OcrItem[];
  language: string;
  engine: OcrEngine;
  source: "screenshot" | "screenshotOcr" | "fileOcr";
  json_path: string | null;
  txt_path: string | null;
  payload: OcrPayload;
};

export type NativeCaptureResponse = {
  action: "save" | "copy" | "ocr" | "cancel";
  imagePath: string | null;
  fileName: string | null;
  rect: { x: number; y: number; width: number; height: number } | null;
  message: string;
  ocr: ScreenshotOcrResponse | null;
};

export type TranslateResponse = {
  translated_text: string;
  raw: unknown;
};

export type ClipboardTextResponse = {
  text: string;
};

/// 剪贴板历史项类型。kind 区分文本/图片/文件/文件夹；
/// created_at 是 unix 毫秒字符串，前端用 new Date(Number(createdAt)) 解析。
export type ClipboardHistoryItem = {
  id: string;
  kind: "text" | "image" | "files" | "unknown";
  text?: string;
  image_path?: string;
  paths?: string[];
  size_bytes?: number;
  mime_type?: string;
  is_dir?: boolean;
  file_count?: number;
  source: "manual" | "ocr" | "translation" | "clipboard";
  created_at: string;
  pinned: boolean;
  expired: boolean;
};

export type ClipboardRepoConfig = {
  max_items: number;
};

export type ColorSampleResponse = {
  image_path: string;
  hex: string;
  rgb: string;
  hsl: string;
  red: number;
  green: number;
  blue: number;
};

export type OcrDialogData = {
  imagePath: string;
  recognizedText: string;
  items: OcrItem[];
  language: string;
  engine: OcrEngine;
  source: "screenshot" | "screenshotOcr" | "fileOcr";
};
