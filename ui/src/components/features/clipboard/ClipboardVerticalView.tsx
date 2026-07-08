import { convertFileSrc } from "@tauri-apps/api/core";
import type { KeyboardEvent, MouseEvent } from "react";
import { AppButton, EmptyState } from "../../ui";
import type { ClipboardHistoryItem } from "../../../types";
import {
  baseName,
  createdLabel,
  kindIcon,
  kindLabel,
  metaText,
} from "./clipboardViewShared";

type ClipboardVerticalViewProps = {
  items: ClipboardHistoryItem[];
  totalCount: number;
  onDelete: (id: string) => void;
  onAfterUse?: () => void;
  onTogglePinned: (id: string, pinned: boolean) => Promise<void>;
  onUseItem: (id: string) => Promise<boolean>;
};

export function ClipboardVerticalView({
  items,
  totalCount,
  onDelete,
  onAfterUse,
  onTogglePinned,
  onUseItem,
}: ClipboardVerticalViewProps) {
  if (items.length === 0) {
    return (
      <EmptyState variant="result">
        {totalCount === 0 ? "复制内容后会自动显示在这里。" : "当前筛选下没有记录。"}
      </EmptyState>
    );
  }

  const useAndClose = async (item: ClipboardHistoryItem) => {
    if (item.expired) return;
    const used = await onUseItem(item.id);
    if (used) {
      onAfterUse?.();
    }
  };

  const handleRowClick = (event: MouseEvent<HTMLElement>, item: ClipboardHistoryItem) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, select, [role='button']")) {
      return;
    }
    void useAndClose(item);
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLElement>, item: ClipboardHistoryItem) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    void useAndClose(item);
  };

  return (
    <ul className="clipboard-vertical-list">
      {items.map((item) => (
        <li
          aria-disabled={item.expired}
          className={`clipboard-vertical-row kind-${item.kind}${item.expired ? " is-expired" : ""}${
            item.pinned ? " is-pinned" : ""
          }`}
          key={item.id}
          onClick={(event) => handleRowClick(event, item)}
          onKeyDown={(event) => handleRowKeyDown(event, item)}
          tabIndex={item.expired ? -1 : 0}
        >
          <span className="clipboard-kind-badge" data-kind={item.kind}>
            {kindIcon(item.kind, item.is_dir)}
          </span>
          <div className="clipboard-vertical-main">
            <div className="clipboard-vertical-head">
              <strong>{previewTitle(item)}</strong>
              <span>{createdLabel(item)}</span>
            </div>
            <div className="clipboard-vertical-body">
              <ClipboardPreview item={item} />
            </div>
            <div className="clipboard-vertical-meta">
              <span>{kindLabel(item.kind, item.is_dir)}</span>
              {metaText(item) && <span>{metaText(item)}</span>}
              {item.expired && <span>源文件已不存在</span>}
            </div>
          </div>
          <div className="clipboard-vertical-actions">
            <AppButton disabled={item.expired} onClick={() => void useAndClose(item)} variant="text">
              使用
            </AppButton>
            <AppButton onClick={() => onTogglePinned(item.id, !item.pinned)} variant="text">
              {item.pinned ? "取消置顶" : "置顶"}
            </AppButton>
            <AppButton onClick={() => onDelete(item.id)} variant="text">
              删除
            </AppButton>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ClipboardPreview({ item }: { item: ClipboardHistoryItem }) {
  if (item.kind === "text") {
    return <p className="clipboard-preview-text">{item.text}</p>;
  }
  if (item.kind === "image" && item.image_path) {
    return <img alt="剪贴板图片" className="clipboard-preview-image" src={convertFileSrc(item.image_path)} />;
  }
  if (item.kind === "files" && item.paths) {
    return (
      <ul className="clipboard-preview-files">
        {item.paths.map((path) => (
          <li key={path} title={path}>
            {baseName(path)}
          </li>
        ))}
      </ul>
    );
  }
  return <p className="clipboard-preview-text">无法预览</p>;
}

function previewTitle(item: ClipboardHistoryItem) {
  if (item.kind === "text") return item.text?.split(/\s+/).find(Boolean) || "文本";
  if (item.kind === "files" && item.paths?.[0]) return baseName(item.paths[0]);
  if (item.kind === "image") return "图片";
  return kindLabel(item.kind, item.is_dir);
}
