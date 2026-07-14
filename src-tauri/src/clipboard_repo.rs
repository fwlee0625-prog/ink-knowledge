use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::paths::app_data_dir;

/// 剪贴板历史项类型。kind=files 时可表示文件或文件夹，paths 非空；
/// kind=image 时 imagePath 指向 App 数据目录下的 PNG；kind=text 时 text 非空。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardHistoryItem {
    pub id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_dir: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_count: Option<i64>,
    pub source: String,
    pub created_at: String,
    /// 数据库仍使用 pinned 列兼容既有历史，接口语义为收藏。
    pub favorite: bool,
    pub expired: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClipboardRepoConfig {
    pub max_items: usize,
}

impl Default for ClipboardRepoConfig {
    fn default() -> Self {
        Self { max_items: 100 }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_test_item(conn: &Connection, id: &str, created_at: &str, favorite: bool) {
        conn.execute(
            "INSERT INTO clipboard_items
                (id, kind, source, created_at, pinned, expired)
             VALUES (?1, 'text', 'clipboard', ?2, ?3, 0)",
            params![id, created_at, if favorite { 1 } else { 0 }],
        )
        .unwrap();
    }

    fn insert_test_image_item(conn: &Connection, id: &str, image_path: &Path) {
        conn.execute(
            "INSERT INTO clipboard_items
                (id, kind, image_path, source, created_at, pinned, expired)
             VALUES (?1, 'image', ?2, 'clipboard', '2026-01-01T00:00:00Z', 0, 0)",
            params![id, image_path.display().to_string()],
        )
        .unwrap();
    }

    #[test]
    fn prune_keeps_favorites_and_latest_regular_items_without_reordering() {
        let conn = Connection::open_in_memory().unwrap();
        ClipboardRepo::run_migrations(&conn).unwrap();
        insert_test_item(&conn, "favorite-old", "2026-01-01T00:00:00Z", true);
        insert_test_item(&conn, "old", "2026-01-02T00:00:00Z", false);
        insert_test_item(&conn, "newer", "2026-01-03T00:00:00Z", false);
        insert_test_item(&conn, "newest", "2026-01-04T00:00:00Z", false);

        ClipboardRepo::prune_with_conn(&conn, 2).unwrap();

        let mut stmt = conn
            .prepare("SELECT id FROM clipboard_items ORDER BY created_at DESC")
            .unwrap();
        let ids = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(ids, vec!["newest", "newer", "favorite-old"]);
    }

    #[test]
    fn clear_keeps_favorites() {
        let conn = Connection::open_in_memory().unwrap();
        ClipboardRepo::run_migrations(&conn).unwrap();
        insert_test_item(&conn, "favorite", "2026-01-01T00:00:00Z", true);
        insert_test_item(&conn, "regular", "2026-01-02T00:00:00Z", false);

        ClipboardRepo::clear_non_favorites_with_conn(&conn).unwrap();

        let ids = conn
            .prepare("SELECT id FROM clipboard_items ORDER BY created_at DESC")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(ids, vec!["favorite"]);
    }

    #[test]
    fn cleanup_unreferenced_images_keeps_referenced_files() {
        let conn = Connection::open_in_memory().unwrap();
        ClipboardRepo::run_migrations(&conn).unwrap();
        let image_dir =
            std::env::temp_dir().join(format!("moshi-clipboard-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&image_dir);
        std::fs::create_dir_all(&image_dir).unwrap();
        let referenced = image_dir.join("referenced.png");
        let orphan = image_dir.join("orphan.png");
        std::fs::write(&referenced, b"referenced").unwrap();
        std::fs::write(&orphan, b"orphan").unwrap();
        insert_test_image_item(&conn, "image-1", &referenced);

        ClipboardRepo::cleanup_unreferenced_images_with_conn(&conn, &image_dir).unwrap();

        assert!(referenced.exists());
        assert!(!orphan.exists());
        let _ = std::fs::remove_dir_all(&image_dir);
    }
}

/// 单例 DB 句柄。Mutex 包裹保证多线程安全。
pub struct ClipboardRepo {
    conn: Mutex<Connection>,
    config: Mutex<ClipboardRepoConfig>,
    image_dir: PathBuf,
}

impl ClipboardRepo {
    pub fn open(app: &tauri::AppHandle) -> Result<Self, String> {
        let dir = app_data_dir(app)?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
        let db_path = dir.join("clipboard.db");
        let conn = Connection::open(db_path).map_err(|e| format!("打开剪贴板数据库失败: {e}"))?;
        // WAL 模式，减少写阻塞读
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("设置 WAL 失败: {e}"))?;
        Self::run_migrations(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
            config: Mutex::new(ClipboardRepoConfig::default()),
            image_dir: dir.join("clipboard-images"),
        })
    }

    pub fn set_config(&self, config: ClipboardRepoConfig) -> Result<(), String> {
        let max_items = config.max_items;
        if let Ok(mut guard) = self.config.lock() {
            *guard = config;
        } else {
            return Err("锁剪贴板配置失败".to_string());
        }
        self.prune(max_items)?;
        self.cleanup_unreferenced_images()
    }

    fn run_migrations(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS clipboard_items (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                text TEXT,
                image_path TEXT,
                paths_json TEXT,
                size_bytes INTEGER,
                mime_type TEXT,
                is_dir INTEGER,
                file_count INTEGER,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL,
                pinned INTEGER DEFAULT 0,
                expired INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_kind_created ON clipboard_items(kind, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_pinned_created ON clipboard_items(pinned, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_text ON clipboard_items(text);",
        )
        .map_err(|e| format!("初始化剪贴板表失败: {e}"))?;
        Ok(())
    }

    /// 插入一条记录。会自动按 max_items 裁剪未收藏的旧记录。
    /// text 类型按 text 去重；files 类型按 paths_json 去重；image 不去重（每次复制都视为新项）。
    pub fn insert(&self, mut item: ClipboardHistoryItem) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;

        // text 类型按 text 字段去重
        if item.kind == "text" {
            if let Some(text) = &item.text {
                let existing_favorite: Option<i64> = conn
                    .query_row(
                        "SELECT pinned FROM clipboard_items WHERE kind = 'text' AND text = ?1",
                        params![text],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| format!("查询文本收藏状态失败: {e}"))?;
                item.favorite |= existing_favorite.unwrap_or(0) != 0;
                conn.execute(
                    "DELETE FROM clipboard_items WHERE kind = 'text' AND text = ?1",
                    params![text],
                )
                .ok();
            }
        }
        // files 类型按 paths_json 去重
        if item.kind == "files" {
            if let Some(paths) = &item.paths {
                let json = serde_json::to_string(paths).unwrap_or_default();
                let existing_favorite: Option<i64> = conn
                    .query_row(
                        "SELECT pinned FROM clipboard_items WHERE kind = 'files' AND paths_json = ?1",
                        params![json],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| format!("查询文件收藏状态失败: {e}"))?;
                item.favorite |= existing_favorite.unwrap_or(0) != 0;
                conn.execute(
                    "DELETE FROM clipboard_items WHERE kind = 'files' AND paths_json = ?1",
                    params![json],
                )
                .ok();
            }
        }

        let paths_json = item
            .paths
            .as_ref()
            .map(|p| serde_json::to_string(p).unwrap_or_default());
        let is_dir_int = item.is_dir.map(|b| if b { 1 } else { 0 });
        let pinned_int = if item.favorite { 1 } else { 0 };
        let expired_int = if item.expired { 1 } else { 0 };

        conn.execute(
            "INSERT INTO clipboard_items
                (id, kind, text, image_path, paths_json, size_bytes, mime_type,
                 is_dir, file_count, source, created_at, pinned, expired)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                item.id,
                item.kind,
                item.text,
                item.image_path,
                paths_json,
                item.size_bytes,
                item.mime_type,
                is_dir_int,
                item.file_count,
                item.source,
                item.created_at,
                pinned_int,
                expired_int,
            ],
        )
        .map_err(|e| format!("插入剪贴板记录失败: {e}"))?;

        // 裁剪：保留所有收藏项 + 未收藏中最新的 max_items 条
        let max_items = self.config.lock().map(|c| c.max_items).unwrap_or(100);
        let image_paths = Self::prune_with_conn(&conn, max_items)?;
        Self::remove_image_files(image_paths);

        Ok(())
    }

    pub fn prune(&self, max_items: usize) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        let image_paths = Self::prune_with_conn(&conn, max_items)?;
        Self::remove_image_files(image_paths);
        Ok(())
    }

    fn prune_with_conn(conn: &Connection, max_items: usize) -> Result<Vec<String>, String> {
        let mut stmt = conn
            .prepare(
                "SELECT image_path FROM clipboard_items
                 WHERE pinned = 0
                   AND image_path IS NOT NULL
                   AND id NOT IN (
                     SELECT id FROM clipboard_items
                     WHERE pinned = 0
                     ORDER BY created_at DESC
                     LIMIT ?1
                 )",
            )
            .map_err(|e| format!("准备裁剪图片查询失败: {e}"))?;
        let image_paths = stmt
            .query_map(params![max_items as i64], |row| row.get::<_, String>(0))
            .map_err(|e| format!("查询待裁剪图片失败: {e}"))?
            .filter_map(|row| row.ok())
            .collect::<Vec<_>>();

        conn.execute(
            "DELETE FROM clipboard_items
             WHERE pinned = 0
               AND id NOT IN (
                 SELECT id FROM clipboard_items
                 WHERE pinned = 0
                 ORDER BY created_at DESC
                 LIMIT ?1
             )",
            params![max_items as i64],
        )
        .map_err(|e| format!("裁剪剪贴板历史失败: {e}"))?;
        Ok(image_paths)
    }

    fn remove_image_files(paths: Vec<String>) {
        for path in paths {
            let _ = std::fs::remove_file(PathBuf::from(path));
        }
    }

    pub fn cleanup_unreferenced_images(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        Self::cleanup_unreferenced_images_with_conn(&conn, &self.image_dir)
    }

    pub fn is_empty(&self) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM clipboard_items", [], |row| row.get(0))
            .map_err(|e| format!("查询剪贴板记录数量失败: {e}"))?;
        Ok(count == 0)
    }

    fn cleanup_unreferenced_images_with_conn(
        conn: &Connection,
        image_dir: &Path,
    ) -> Result<(), String> {
        if !image_dir.exists() {
            return Ok(());
        }

        let mut stmt = conn
            .prepare("SELECT image_path FROM clipboard_items WHERE image_path IS NOT NULL")
            .map_err(|e| format!("准备图片引用查询失败: {e}"))?;
        let referenced = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("查询图片引用失败: {e}"))?
            .filter_map(|row| row.ok())
            .map(PathBuf::from)
            .collect::<std::collections::HashSet<_>>();

        let entries = std::fs::read_dir(image_dir)
            .map_err(|e| format!("读取剪贴板图片缓存失败 {}: {e}", image_dir.display()))?;
        for entry in entries {
            let path = entry
                .map_err(|e| format!("读取剪贴板图片缓存条目失败: {e}"))?
                .path();
            if path.is_file() && !referenced.contains(&path) {
                let _ = std::fs::remove_file(path);
            }
        }
        Ok(())
    }

    pub fn list(&self, limit: usize) -> Result<Vec<ClipboardHistoryItem>, String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, text, image_path, paths_json, size_bytes, mime_type,
                        is_dir, file_count, source, created_at, pinned, expired
                 FROM clipboard_items
                 ORDER BY created_at DESC
                 LIMIT ?1",
            )
            .map_err(|e| format!("准备查询失败: {e}"))?;

        let rows = stmt
            .query_map(params![limit as i64], |row| {
                let text: Option<String> = row.get(2)?;
                let image_path: Option<String> = row.get(3)?;
                let paths_json: Option<String> = row.get(4)?;
                let size_bytes: Option<i64> = row.get(5)?;
                let mime_type: Option<String> = row.get(6)?;
                let is_dir_int: Option<i64> = row.get(7)?;
                let file_count: Option<i64> = row.get(8)?;
                let pinned_int: i64 = row.get(11)?;
                let expired_int: i64 = row.get(12)?;

                let paths: Option<Vec<String>> = paths_json
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok());

                Ok(ClipboardHistoryItem {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    text,
                    image_path,
                    paths,
                    size_bytes,
                    mime_type,
                    is_dir: is_dir_int.map(|v| v != 0),
                    file_count,
                    source: row.get(9)?,
                    created_at: row.get(10)?,
                    favorite: pinned_int != 0,
                    expired: expired_int != 0,
                })
            })
            .map_err(|e| format!("查询失败: {e}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|e| format!("读取行失败: {e}"))?);
        }
        Ok(items)
    }

    pub fn get(&self, id: &str) -> Result<Option<ClipboardHistoryItem>, String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        conn.query_row(
            "SELECT id, kind, text, image_path, paths_json, size_bytes, mime_type,
                    is_dir, file_count, source, created_at, pinned, expired
             FROM clipboard_items
             WHERE id = ?1",
            params![id],
            |row| {
                let text: Option<String> = row.get(2)?;
                let image_path: Option<String> = row.get(3)?;
                let paths_json: Option<String> = row.get(4)?;
                let size_bytes: Option<i64> = row.get(5)?;
                let mime_type: Option<String> = row.get(6)?;
                let is_dir_int: Option<i64> = row.get(7)?;
                let file_count: Option<i64> = row.get(8)?;
                let pinned_int: i64 = row.get(11)?;
                let expired_int: i64 = row.get(12)?;
                let paths: Option<Vec<String>> = paths_json
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok());

                Ok(ClipboardHistoryItem {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    text,
                    image_path,
                    paths,
                    size_bytes,
                    mime_type,
                    is_dir: is_dir_int.map(|v| v != 0),
                    file_count,
                    source: row.get(9)?,
                    created_at: row.get(10)?,
                    favorite: pinned_int != 0,
                    expired: expired_int != 0,
                })
            },
        )
        .optional()
        .map_err(|e| format!("查询剪贴板记录失败: {e}"))
    }

    pub fn touch(&self, id: &str, created_at: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        conn.execute(
            "UPDATE clipboard_items SET created_at = ?1, expired = 0 WHERE id = ?2",
            params![created_at, id],
        )
        .map_err(|e| format!("更新剪贴板记录时间失败: {e}"))?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        // 先取出图片路径，删除记录时同时清理图片文件
        let image_path: Option<String> = conn
            .query_row(
                "SELECT image_path FROM clipboard_items WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("查询图片路径失败: {e}"))?;
        if let Some(path) = image_path {
            let _ = std::fs::remove_file(PathBuf::from(path));
        }
        conn.execute("DELETE FROM clipboard_items WHERE id = ?1", params![id])
            .map_err(|e| format!("删除记录失败: {e}"))?;
        Ok(())
    }

    pub fn clear_non_favorites(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        let image_paths = Self::clear_non_favorites_with_conn(&conn)?;
        conn.execute_batch(
            "PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);",
        )
        .map_err(|e| format!("压缩剪贴板数据库失败: {e}"))?;
        Self::remove_image_files(image_paths);
        Self::cleanup_unreferenced_images_with_conn(&conn, &self.image_dir)?;
        Ok(())
    }

    fn clear_non_favorites_with_conn(conn: &Connection) -> Result<Vec<String>, String> {
        // 取出未收藏图片路径，清空时保留收藏记录及其缓存。
        let mut stmt = conn
            .prepare("SELECT image_path FROM clipboard_items WHERE pinned = 0 AND image_path IS NOT NULL")
            .map_err(|e| format!("准备查询失败: {e}"))?;
        let image_paths: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| format!("查询失败: {e}"))?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        conn.execute("DELETE FROM clipboard_items WHERE pinned = 0", [])
            .map_err(|e| format!("清空记录失败: {e}"))?;
        Ok(image_paths)
    }

    pub fn set_favorite(&self, id: &str, favorite: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        let pinned_int = if favorite { 1 } else { 0 };
        conn.execute(
            "UPDATE clipboard_items SET pinned = ?1 WHERE id = ?2",
            params![pinned_int, id],
        )
        .map_err(|e| format!("更新收藏失败: {e}"))?;
        Ok(())
    }

    /// 校验文件/图片项的源是否仍存在，失效则标记 expired，返回失效条数。
    pub fn refresh_expired(&self) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, image_path, paths_json FROM clipboard_items
                 WHERE kind IN ('image', 'files')",
            )
            .map_err(|e| format!("准备查询失败: {e}"))?;

        let rows = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let image_path: Option<String> = row.get(1)?;
                let paths_json: Option<String> = row.get(2)?;
                Ok((id, image_path, paths_json))
            })
            .map_err(|e| format!("查询失败: {e}"))?;

        let mut expired_count = 0;
        for row in rows {
            let (id, image_path, paths_json) = row.map_err(|e| format!("读取行失败: {e}"))?;
            let mut exists = true;
            if let Some(p) = &image_path {
                if !PathBuf::from(p).exists() {
                    exists = false;
                }
            }
            if let Some(json) = &paths_json {
                if let Some(paths) = serde_json::from_str::<Vec<String>>(json).ok() {
                    for p in &paths {
                        if !PathBuf::from(p).exists() {
                            exists = false;
                            break;
                        }
                    }
                }
            }
            let expired_int = if exists { 0 } else { 1 };
            conn.execute(
                "UPDATE clipboard_items SET expired = ?1 WHERE id = ?2",
                params![expired_int, id],
            )
            .ok();
            if !exists {
                expired_count += 1;
            }
        }
        Ok(expired_count)
    }
}
