export const ocrLanguageOptions: Array<{ label: string; value: string }> = [
  { label: "中文简体（默认）", value: "ch" },
  { label: "中文简体", value: "zh-Hans" },
  { label: "中文繁体", value: "zh-Hant" },
  { label: "英文", value: "en" },
  { label: "日文", value: "ja" },
  { label: "韩文", value: "ko" },
];

const ocrLanguageAliases: Record<string, string> = {
  zh: "ch",
  cn: "ch",
  "zh-cn": "ch",
  "zh-hans": "zh-Hans",
  cht: "zh-Hant",
  tw: "zh-Hant",
  "zh-tw": "zh-Hant",
  "zh-hant": "zh-Hant",
  "en-us": "en",
  jp: "ja",
  "ja-jp": "ja",
  kr: "ko",
  "ko-kr": "ko",
};

export function normalizeOcrLanguage(value: string | null | undefined) {
  const normalized = (value ?? "").trim().replaceAll("_", "-").toLowerCase();
  if (!normalized) {
    return "ch";
  }

  return (
    ocrLanguageAliases[normalized] ??
    ocrLanguageOptions.find((option) => option.value.toLowerCase() === normalized)?.value ??
    "ch"
  );
}
