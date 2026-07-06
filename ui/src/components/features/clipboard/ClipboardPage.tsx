import { convertFileSrc } from "@tauri-apps/api/core";
import { useMemo, useState } from "react";
import { AppButton, Card, EmptyState } from "../../ui";
import type { ClipboardHistoryItem } from "../../../types";

type ClipboardPageProps = {
  busy: boolean;
  history: ClipboardHistoryItem[];
  onClear: () => void;
  onDelete: (id: string) => void;
  onReadCurrent: () => Promise<void>;
  onTogglePinned: (id: string, pinned: boolean) => Promise<void>;
  onUseItem: (id: string) => Promise<void>;
};

type KindFilter = "all" | "text" | "image" | "files";

export function ClipboardPage({
  busy,
  history,
  onClear,
  onDelete,
  onReadCurrent,
  onTogglePinned,
  onUseItem,
}: ClipboardPageProps) {
  const [keyword, setKeyword] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const visibleItems = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return history.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (!query) return true;
      // 文本项搜 text；文件项搜 paths 中的文件名
      if (item.text) return item.text.toLowerCase().includes(query);
      if (item.paths) return item.paths.some((p) => p.toLowerCase().includes(query));
      return false;
    });
  }, [history, keyword, kindFilter]);

  const counts = useMemo(() => {
    const c = { text: 0, image: 0, files: 0 };
    for (const item of history) {
      if (item.kind === "text") c.text += 1;
      else if (item.kind === "image") c.image += 1;
      else if (item.kind === "files") c.files += 1;
    }
    return c;
  }, [history]);

  return (
    <section className="tool-workspace clipboard-workspace">
      <Card className="tool-panel">
        <div className="tool-title">
          <p className="eyebrow">Clipboard</p>
          <h2>剪贴板</h2>
          <span>自动捕获文本、图片和文件复制；视频等大文件只存路径，不复制内容。</span>
        </div>
        <div className="file-row">
          <input
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索文本或文件名"
            value={keyword}
          />
          <AppButton disabled={busy} onClick={onReadCurrent}>
            读取当前
          </AppButton>
        </div>
        <div className="clipboard-filter-row">
          {(["all", "text", "image", "files"] as KindFilter[]).map((k) => (
            <AppButton
              active={kindFilter === k}
              key={k}
              onClick={() => setKindFilter(k)}
              variant="text"
            >
              {filterLabel(k, counts)}
            </AppButton>
          ))}
          <span className="clipboard-spacer" />
          <AppButton disabled={history.length === 0} onClick={onClear} variant="text">
            清空历史
          </AppButton>
        </div>
      </Card>

      <Card className="tool-detail-panel" variant="result">
        {visibleItems.length === 0 ? (
          <EmptyState variant="result">
            {history.length === 0 ? "复制内容后会自动显示在这里。" : "当前筛选下没有记录。"}
          </EmptyState>
        ) : (
          <ul className="history-list">
            {visibleItems.map((item) => (
              <ClipboardRow
                item={item}
                key={item.id}
                onDelete={onDelete}
                onTogglePinned={onTogglePinned}
                onUseItem={onUseItem}
              />
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function filterLabel(kind: KindFilter, counts: { text: number; image: number; files: number }) {
  if (kind === "all") return `全部 ${counts.text + counts.image + counts.files}`;
  if (kind === "text") return `文本 ${counts.text}`;
  if (kind === "image") return `图片 ${counts.image}`;
  return `文件 ${counts.files}`;
}

type ClipboardRowProps = {
  item: ClipboardHistoryItem;
  onDelete: (id: string) => void;
  onTogglePinned: (id: string, pinned: boolean) => Promise<void>;
  onUseItem: (id: string) => Promise<void>;
};

function ClipboardRow({ item, onDelete, onTogglePinned, onUseItem }: ClipboardRowProps) {
  const created = new Date(Number(item.created_at));
  const createdLabel = Number.isNaN(created.getTime()) ? item.created_at : created.toLocaleString();

  return (
    <li className={`clipboard-row kind-${item.kind}${item.expired ? " is-expired" : ""}${item.pinned ? " is-pinned" : ""}`}>
      <div className="clipboard-row-main">
        <div className="clipboard-row-head">
          <span className="clipboard-kind-badge" data-kind={item.kind}>
            {kindIcon(item.kind, item.is_dir)}
          </span>
          <strong>{kindLabel(item.kind, item.is_dir)}</strong>
          <span className="clipboard-meta">{metaText(item)}</span>
          <span>{createdLabel}</span>
        </div>
        <div className="clipboard-row-body">
          {item.kind === "text" && <p className="clipboard-text">{item.text}</p>}
          {item.kind === "image" && item.image_path && (
            <img
              alt="剪贴板图片"
              className="clipboard-image"
              src={convertFileSrc(item.image_path)}
            />
          )}
          {item.kind === "files" && item.paths && (
            <ul className="clipboard-file-list">
              {item.paths.map((p) => (
                <li key={p} title={p}>
                  <span className="clipboard-file-icon">{item.is_dir ? "📁" : "📄"}</span>
                  <span className="clipboard-file-name">{baseName(p)}</span>
                </li>
              ))}
            </ul>
          )}
          {item.expired && <p className="clipboard-expired-hint">源文件已不存在</p>}
        </div>
      </div>
      <div className="button-row clipboard-row-actions">
        <AppButton disabled={item.expired} onClick={() => onUseItem(item.id)} variant="text">
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
  );
}

function kindIcon(kind: string, isDir?: boolean) {
  if (kind === "text") return "📝";
  if (kind === "image") return "🖼️";
  if (kind === "files") return isDir ? "📁" : "📄";
  return "❓";
}

function kindLabel(kind: string, isDir?: boolean) {
  if (kind === "text") return "文本";
  if (kind === "image") return "图片";
  if (kind === "files") return isDir ? "文件夹" : "文件";
  return "未知";
}

function metaText(item: ClipboardHistoryItem) {
  if (item.kind === "files") {
    if (item.file_count && item.file_count > 1) return `${item.file_count} 项`;
    if (item.size_bytes !== undefined && item.size_bytes !== null) return formatSize(item.size_bytes);
    if (item.is_dir) return "文件夹";
    return "";
  }
  if (item.kind === "image" && item.size_bytes !== undefined && item.size_bytes !== null) {
    return formatSize(item.size_bytes);
  }
  if (item.kind === "text" && item.text) return `${item.text.length} 字符`;
  return "";
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function baseName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}
