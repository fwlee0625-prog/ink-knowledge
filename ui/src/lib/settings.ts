import type { AppSettings } from "../types";
import { clampNumber } from "./format";

export const settingsKey = "mac-local-ocr.settings";

export const fallbackSettings: AppSettings = {
  outputDir: "",
  ocrEngine: "apple-vision",
  dpi: 300,
  lang: "ch",
  forceOcr: false,
  outputTxt: true,
  outputJson: false,
  recursionDepth: 1,
};

export function readSavedSettings(): Partial<AppSettings> {
  try {
    const raw = localStorage.getItem(settingsKey);
    const saved = raw ? (JSON.parse(raw) as Partial<AppSettings>) : {};
    if (saved.outputTxt === false && saved.outputJson === false) {
      saved.outputTxt = true;
    }
    if (saved.ocrEngine !== "paddle" && saved.ocrEngine !== "apple-vision") {
      saved.ocrEngine = "apple-vision";
    }
    if (typeof saved.recursionDepth === "number") {
      saved.recursionDepth = clampNumber(saved.recursionDepth, 1, 5);
    }
    return saved;
  } catch {
    return {};
  }
}
