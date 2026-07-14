import type { OcrEngine } from "../types";

type OcrEngineText = {
  label: string;
};

export const ocrEngineTexts: Record<OcrEngine, OcrEngineText> = {
  "apple-vision": { label: "极速识别" },
  paddle: { label: "深度识别" },
};

export const ocrEngineOptions: Array<{ label: string; value: OcrEngine }> = (
  Object.entries(ocrEngineTexts) as Array<[OcrEngine, OcrEngineText]>
).map(([value, text]) => ({ label: text.label, value }));

export const ocrEngineSettingsDescription = "极速识别内置可用，深度识别需先安装扩展。";

export function getOcrEngineLabel(engine: string, fallback = engine) {
  return ocrEngineTexts[engine as OcrEngine]?.label ?? fallback;
}
