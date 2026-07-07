import type { AppSettings, OcrResponse, RecognitionProgress } from "../types";

export function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function getOutputFormat(settings: AppSettings) {
  if (settings.outputTxt && settings.outputJson) return "both";
  if (settings.outputJson) return "json";
  return "txt";
}

export function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const fractionDigits = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

export function outputFileName(response: OcrResponse, fallbackPath: string) {
  const names = [response.txt_path, response.json_path].filter(Boolean).map((path) => fileName(path as string));
  return names.length > 0 ? names.join(" / ") : fileName(fallbackPath);
}

export function primaryOutputPath(response: OcrResponse) {
  return response.txt_path ?? response.json_path;
}

export function ocrButtonLabel(busy: boolean, progress: RecognitionProgress) {
  if (!busy) return "开始识别";
  if (progress && progress.total > 2) return `处理中 ${progress.current}/${progress.total}`;
  return "处理中...";
}
