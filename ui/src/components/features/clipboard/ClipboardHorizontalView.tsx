import { convertFileSrc } from "@tauri-apps/api/core";
import type { KeyboardEvent, MouseEvent, WheelEvent } from "react";
import { AppButton, EmptyState } from "../../ui";
import type { ClipboardHistoryItem } from "../../../types";
import {
  baseName,
  createdLabel,
  kindLabel,
} from "./clipboardViewShared";

type ClipboardHorizontalViewProps = {
  items: ClipboardHistoryItem[];
  totalCount: number;
  onDelete: (id: string) => void;
  onAfterUse?: () => void;
  onTogglePinned: (id: string, pinned: boolean) => Promise<void>;
  onUseItem: (id: string) => Promise<boolean>;
};

export function ClipboardHorizontalView({
  items,
  totalCount,
  onDelete,
  onAfterUse,
  onTogglePinned,
  onUseItem,
}: ClipboardHorizontalViewProps) {
  if (items.length === 0) {
    return (
      <EmptyState variant="result">
        {totalCount === 0 ? "复制内容后会自动显示在这里。" : "当前筛选下没有记录。"}
      </EmptyState>
    );
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.currentTarget.scrollLeft += event.deltaY;
    event.preventDefault();
  };

  const useAndClose = async (item: ClipboardHistoryItem) => {
    if (item.expired) return;
    const used = await onUseItem(item.id);
    if (used) {
      onAfterUse?.();
    }
  };

  const handleCardClick = (event: MouseEvent<HTMLElement>, item: ClipboardHistoryItem) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select, [role='button']")) {
      return;
    }
    void useAndClose(item);
  };

  const handleCardKeyDown = (event: KeyboardEvent<HTMLElement>, item: ClipboardHistoryItem) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    void useAndClose(item);
  };

  return (
    <div className="clipboard-shelf" onWheel={handleWheel} role="list">
      {items.map((item) => (
        <article
          aria-disabled={item.expired}
          className={`clipboard-shelf-card kind-${item.kind}${item.expired ? " is-expired" : ""}${
            item.pinned ? " is-pinned" : ""
          }`}
          key={item.id}
          onClick={(event) => handleCardClick(event, item)}
          onKeyDown={(event) => handleCardKeyDown(event, item)}
          role="listitem"
          tabIndex={item.expired ? -1 : 0}
        >
          <div className="clipboard-shelf-strip">
            <span>{kindLabel(item.kind, item.is_dir)}</span>
            <span>{createdLabel(item)}</span>
          </div>
          <div className="clipboard-shelf-body">
            <ClipboardCardPreview item={item} />
          </div>
          <footer className="clipboard-shelf-footer">
            <div className="clipboard-shelf-actions">
              <AppButton onClick={() => onTogglePinned(item.id, !item.pinned)} variant="text">
                {item.pinned ? "取消" : "置顶"}
              </AppButton>
              <AppButton onClick={() => onDelete(item.id)} variant="text">
                删除
              </AppButton>
            </div>
          </footer>
        </article>
      ))}
    </div>
  );
}

function ClipboardCardPreview({ item }: { item: ClipboardHistoryItem }) {
  if (item.kind === "text") {
    return <p className="clipboard-card-text">{item.text}</p>;
  }
  if (item.kind === "image" && item.image_path) {
    return (
      <div className="clipboard-card-media">
        <img alt="剪贴板图片" className="clipboard-card-image" src={convertFileSrc(item.image_path)} />
      </div>
    );
  }
  if (item.kind === "files" && item.paths) {
    return (
      <ul className="clipboard-card-files">
        {item.paths.slice(0, 3).map((path) => (
          <li key={path} title={path}>
            {baseName(path)}
          </li>
        ))}
      </ul>
    );
  }
  return <p className="clipboard-card-text">无法预览</p>;
}
