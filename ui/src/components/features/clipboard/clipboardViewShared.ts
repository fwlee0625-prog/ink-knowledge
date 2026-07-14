import type { ClipboardHistoryItem } from "../../../types";
import type { ClipboardKindFilter } from "./useClipboardViewModel";

export type ClipboardCounts = { text: number; image: number; files: number; favorites: number };

export function filterLabel(kind: ClipboardKindFilter, counts: ClipboardCounts) {
  if (kind === "all") return `全部 ${counts.text + counts.image + counts.files}`;
  if (kind === "text") return `文本 ${counts.text}`;
  if (kind === "image") return `图片 ${counts.image}`;
  if (kind === "favorites") return `收藏 ${counts.favorites}`;
  return `文件 ${counts.files}`;
}

export function kindLabel(kind: string, isDir?: boolean) {
  if (kind === "text") return "文本";
  if (kind === "image") return "图片";
  if (kind === "files") return isDir ? "文件夹" : "文件";
  return "未知";
}

export function metaText(item: ClipboardHistoryItem) {
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

export function createdLabel(item: ClipboardHistoryItem) {
  const created = new Date(Number(item.created_at));
  if (Number.isNaN(created.getTime())) return item.created_at;
  return created.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function baseName(path: string) {
  return path.split(/[\\/]/).pop() || path;
}
