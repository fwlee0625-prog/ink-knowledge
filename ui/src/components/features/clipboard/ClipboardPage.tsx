import { AppButton, Card } from "../../ui";
import type { ClipboardLayout } from "../../../types";
import { ClipboardHorizontalView } from "./ClipboardHorizontalView";
import { ClipboardVerticalView } from "./ClipboardVerticalView";
import { filterLabel } from "./clipboardViewShared";
import { useClipboardViewModel } from "./useClipboardViewModel";
import type { ClipboardKindFilter } from "./useClipboardViewModel";

type ClipboardPageProps = {
  layout: ClipboardLayout;
  model: ReturnType<typeof useClipboardViewModel>;
};

const filters: ClipboardKindFilter[] = ["all", "text", "image", "files"];

export function ClipboardPage({ layout, model }: ClipboardPageProps) {
  const content =
    layout === "horizontal" ? (
      <ClipboardHorizontalView
        items={model.visibleItems}
        onDelete={model.deleteItem}
        onTogglePinned={model.togglePinned}
        onUseItem={model.useItem}
        totalCount={model.history.length}
      />
    ) : (
      <ClipboardVerticalView
        items={model.visibleItems}
        onDelete={model.deleteItem}
        onTogglePinned={model.togglePinned}
        onUseItem={model.useItem}
        totalCount={model.history.length}
      />
    );

  return (
    <section className={`tool-workspace clipboard-workspace clipboard-layout-${layout}`}>
      <Card className="tool-panel clipboard-control-panel">
        <div className="tool-title">
          <p className="eyebrow">Clipboard</p>
          <h2>剪贴板</h2>
          <span>自动捕获文本、图片和文件复制；视频等大文件只存路径，不复制内容。</span>
        </div>
        <div className="file-row">
          <input
            onChange={(event) => model.setKeyword(event.target.value)}
            placeholder="搜索文本或文件名"
            value={model.keyword}
          />
          <AppButton disabled={model.busy} onClick={model.readCurrent}>
            读取当前
          </AppButton>
        </div>
        <ClipboardFilterTabs
          counts={model.counts}
          kindFilter={model.kindFilter}
          onChange={model.setKindFilter}
        />
      </Card>

      <Card className="tool-detail-panel clipboard-result-panel" variant="result">
        <div className="clipboard-result-head">
          <span>{model.visibleItems.length} 条</span>
          <AppButton disabled={model.history.length === 0} onClick={model.clearHistory} variant="text">
            清空历史
          </AppButton>
        </div>
        {content}
      </Card>
    </section>
  );
}

type ClipboardFilterTabsProps = {
  counts: { text: number; image: number; files: number };
  kindFilter: ClipboardKindFilter;
  onChange: (kind: ClipboardKindFilter) => void;
};

export function ClipboardFilterTabs({ counts, kindFilter, onChange }: ClipboardFilterTabsProps) {
  return (
    <div className="clipboard-filter-tabs" role="tablist">
      {filters.map((kind) => (
        <button
          aria-selected={kindFilter === kind}
          className={kindFilter === kind ? "active" : ""}
          key={kind}
          onClick={() => onChange(kind)}
          role="tab"
          type="button"
        >
          {filterLabel(kind, counts)}
        </button>
      ))}
    </div>
  );
}
