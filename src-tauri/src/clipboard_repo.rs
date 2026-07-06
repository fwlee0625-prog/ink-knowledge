use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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
    pub pinned: bool,
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

/// 单例 DB 句柄。Mutex 包裹保证多线程安全。
pub struct ClipboardRepo {
    conn: Mutex<Connection>,
    config: Mutex<ClipboardRepoConfig>,
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
        })
    }

    pub fn set_config(&self, config: ClipboardRepoConfig) {
        if let Ok(mut guard) = self.config.lock() {
            *guard = config;
        }
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

    /// 插入一条记录。会自动按 max_items 裁剪未置顶的旧记录。
    /// text 类型按 text 去重；files 类型按 paths_json 去重；image 不去重（每次复制都视为新项）。
    pub fn insert(&self, item: ClipboardHistoryItem) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;

        // text 类型按 text 字段去重
        if item.kind == "text" {
            if let Some(text) = &item.text {
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
        let pinned_int = if item.pinned { 1 } else { 0 };
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

        // 裁剪：保留所有 pinned 项 + 未 pinned 中最新的 max_items 条
        let max_items = self.config.lock().map(|c| c.max_items).unwrap_or(100);
        conn.execute(
            "DELETE FROM clipboard_items
             WHERE id NOT IN (
                 SELECT id FROM clipboard_items WHERE pinned = 1
                 UNION
                 SELECT id FROM clipboard_items
                 WHERE pinned = 0
                 ORDER BY created_at DESC
                 LIMIT ?1
             )",
            params![max_items as i64],
        )
        .ok();

        Ok(())
    }

    pub fn list(&self, limit: usize) -> Result<Vec<ClipboardHistoryItem>, String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, kind, text, image_path, paths_json, size_bytes, mime_type,
                        is_dir, file_count, source, created_at, pinned, expired
                 FROM clipboard_items
                 ORDER BY pinned DESC, created_at DESC
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
                    pinned: pinned_int != 0,
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
                    pinned: pinned_int != 0,
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

    pub fn clear_all(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        // 取出所有图片路径用于清理文件
        let mut stmt = conn
            .prepare("SELECT image_path FROM clipboard_items WHERE image_path IS NOT NULL")
            .map_err(|e| format!("准备查询失败: {e}"))?;
        let image_paths: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| format!("查询失败: {e}"))?
            .filter_map(|r| r.ok())
            .collect();
        for path in image_paths {
            let _ = std::fs::remove_file(PathBuf::from(path));
        }
        conn.execute("DELETE FROM clipboard_items", [])
            .map_err(|e| format!("清空记录失败: {e}"))?;
        Ok(())
    }

    pub fn set_pinned(&self, id: &str, pinned: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("锁 DB 失败: {e}"))?;
        let pinned_int = if pinned { 1 } else { 0 };
        conn.execute(
            "UPDATE clipboard_items SET pinned = ?1 WHERE id = ?2",
            params![pinned_int, id],
        )
        .map_err(|e| format!("更新置顶失败: {e}"))?;
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
