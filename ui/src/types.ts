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

export type View = "ocr" | "settings";

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
