import { AppButton, Card, EmptyState } from "../../ui";
import type { ColorCopyFormat, ColorSampleResponse } from "../../../types";

type ColorPageProps = {
  busy: boolean;
  copyFormat: ColorCopyFormat;
  recentColors: ColorSampleResponse[];
  onCopyColor: (color: ColorSampleResponse, format?: ColorCopyFormat) => Promise<void>;
  onSampleColor: () => Promise<void>;
};

export function ColorPage({ busy, copyFormat, recentColors, onCopyColor, onSampleColor }: ColorPageProps) {
  const latest = recentColors[0] ?? null;

  return (
    <section className="tool-workspace">
      <Card className="tool-panel">
        <div className="tool-title">
          <p className="eyebrow">Color</p>
          <h2>取色</h2>
          <span>框选屏幕上的一小块区域，取中心像素颜色并保存到最近颜色。</span>
        </div>
        <AppButton disabled={busy} onClick={onSampleColor} variant="primary">
          屏幕取色
        </AppButton>
      </Card>

      <Card className="tool-detail-panel" variant="result">
        {latest ? (
          <div className="color-result">
            <div className="color-swatch-large" style={{ backgroundColor: latest.hex }} />
            <div className="color-values">
              <button onClick={() => onCopyColor(latest, "hex")} type="button">
                {latest.hex}
              </button>
              <button onClick={() => onCopyColor(latest, "rgb")} type="button">
                {latest.rgb}
              </button>
              <button onClick={() => onCopyColor(latest, "hsl")} type="button">
                {latest.hsl}
              </button>
            </div>
            <span>默认复制格式：{copyFormat.toUpperCase()}</span>
          </div>
        ) : (
          <EmptyState variant="result">取色结果会显示在这里。</EmptyState>
        )}

        {recentColors.length > 0 && (
          <div className="recent-colors">
            {recentColors.map((color) => (
              <button
                aria-label={`复制 ${color.hex}`}
                key={`${color.hex}-${color.image_path}`}
                onClick={() => onCopyColor(color)}
                style={{ backgroundColor: color.hex }}
                type="button"
              />
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
