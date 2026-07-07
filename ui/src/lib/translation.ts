import type { AppSettings, TranslationEngine } from "../types";

export const translationEngineLabels: Record<TranslationEngine, string> = {
  "openai-compatible": "OpenAI 兼容",
  volcengine: "火山翻译",
};

export function isTranslationEngineEnabled(settings: AppSettings, engine: TranslationEngine) {
  if (engine === "openai-compatible") return settings.translationOpenaiEnabled;
  return settings.translationVolcEnabled;
}

export function enabledTranslationEngines(settings: AppSettings) {
  return (Object.keys(translationEngineLabels) as TranslationEngine[])
    .filter((engine) => isTranslationEngineEnabled(settings, engine))
    .map((engine) => ({ label: translationEngineLabels[engine], value: engine }));
}

export function resolveTranslationEngine(settings: AppSettings, preferredEngine = settings.translationEngine) {
  if (isTranslationEngineEnabled(settings, preferredEngine)) {
    return preferredEngine;
  }

  return enabledTranslationEngines(settings)[0]?.value ?? null;
}
