import { useState } from "react";
import { AppButton, AppSelect, Card, useMessage } from "../../ui";
import type { TranslationEngine } from "../../../types";

type InlineMessage = {
  text: string;
  tone: "info" | "error";
};

type TranslatePageProps = {
  busy: boolean;
  enabledEngines: Array<{ label: string; value: TranslationEngine }>;
  engine: TranslationEngine;
  onCopyText: (text: string, source?: "ocr" | "translation" | "manual") => Promise<void>;
  onEngineChange: (engine: TranslationEngine) => void;
  onTranslate: (text: string, engine: TranslationEngine) => Promise<string>;
};

export function TranslatePage({
  busy,
  enabledEngines,
  engine,
  onCopyText,
  onEngineChange,
  onTranslate,
}: TranslatePageProps) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [sourceMessage, setSourceMessage] = useState<InlineMessage | null>(null);
  const [translating, setTranslating] = useState(false);
  const message = useMessage();
  const hasEnabledEngine = enabledEngines.length > 0;
  const selectedEngine = enabledEngines.some((item) => item.value === engine) ? engine : enabledEngines[0]?.value;

  const runTranslate = async () => {
    if (!selectedEngine) {
      setSourceMessage({ text: "请先在设置中启用至少一个翻译引擎。", tone: "error" });
      return;
    }
    setSourceMessage({ text: "正在翻译...", tone: "info" });
    setTranslating(true);
    try {
      const translated = await onTranslate(source, selectedEngine);
      setTarget(translated);
      setSourceMessage(null);
    } catch (error) {
      setSourceMessage({ text: error instanceof Error ? error.message : String(error), tone: "error" });
    } finally {
      setTranslating(false);
    }
  };

  const copyText = async (text: string, sourceType: "ocr" | "translation" | "manual") => {
    try {
      await onCopyText(text, sourceType);
      message.success("复制成功");
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="tool-workspace split-tool">
      <Card className="tool-panel">
        <div className="tool-title">
          <p className="eyebrow">Translate</p>
          <h2>翻译</h2>
        </div>
        <div className="translate-engine-row">
          <span>默认引擎</span>
          <AppSelect
            ariaLabel="选择翻译引擎"
            disabled={!hasEnabledEngine || translating}
            onChange={onEngineChange}
            options={enabledEngines}
            value={selectedEngine ?? engine}
          />
        </div>
        <textarea
          className="tool-textarea"
          onChange={(event) => setSource(event.target.value)}
          placeholder="输入或粘贴需要翻译的文本"
          value={source}
        />
        <div className="button-row">
          <AppButton
            disabled={busy || translating || !hasEnabledEngine || !source.trim()}
            onClick={runTranslate}
            variant="primary"
          >
            {translating ? "翻译中..." : "翻译"}
          </AppButton>
          <AppButton disabled={!source.trim()} onClick={() => copyText(source, "manual")}>
            复制原文
          </AppButton>
          {sourceMessage && <p className={`tool-message ${sourceMessage.tone}`}>{sourceMessage.text}</p>}
        </div>
      </Card>

      <Card className="tool-panel">
        <div className="tool-title">
          <p className="eyebrow">Result</p>
          <h2>译文</h2>
        </div>
        <textarea
          className="tool-textarea"
          onChange={(event) => setTarget(event.target.value)}
          placeholder="翻译结果会显示在这里"
          value={target}
        />
        <div className="button-row">
          <AppButton disabled={!target.trim()} onClick={() => copyText(target, "translation")}>
            复制译文
          </AppButton>
        </div>
      </Card>
    </section>
  );
}
