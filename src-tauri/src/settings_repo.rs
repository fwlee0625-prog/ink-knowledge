use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::paths::app_data_dir;

const APP_SETTINGS_KEY: &str = "app";

fn open_connection(app: &tauri::AppHandle) -> Result<Connection, String> {
    let dir = app_data_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    let db_path = dir.join("settings.db");
    let conn = Connection::open(db_path).map_err(|e| format!("打开设置数据库失败: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("设置设置数据库 WAL 失败: {e}"))?;
    run_migrations(&conn)?;
    Ok(conn)
}

fn run_migrations(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );",
    )
    .map_err(|e| format!("初始化设置表失败: {e}"))?;
    Ok(())
}

fn load_json(app: tauri::AppHandle, key: &str) -> Result<Option<Value>, String> {
    let conn = open_connection(&app)?;
    let value_json: Option<String> = conn
        .query_row(
            "SELECT value_json FROM app_settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("读取设置失败: {e}"))?;

    match value_json {
        Some(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| format!("解析设置失败: {e}")),
        None => Ok(None),
    }
}

fn save_json(app: tauri::AppHandle, key: &str, value: Value) -> Result<(), String> {
    let conn = open_connection(&app)?;
    let value_json = serde_json::to_string(&value).map_err(|e| format!("序列化设置失败: {e}"))?;
    let updated_at = unix_millis_string();
    conn.execute(
        "INSERT INTO app_settings (key, value_json, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET
             value_json = excluded.value_json,
             updated_at = excluded.updated_at",
        params![key, value_json, updated_at],
    )
    .map_err(|e| format!("保存设置失败: {e}"))?;
    Ok(())
}

fn clear_key(app: tauri::AppHandle, key: &str) -> Result<(), String> {
    let conn = open_connection(&app)?;
    conn.execute("DELETE FROM app_settings WHERE key = ?1", params![key])
        .map_err(|e| format!("清空设置失败: {e}"))?;
    Ok(())
}

pub fn load_app_settings(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    load_json(app, APP_SETTINGS_KEY)
}

pub fn save_app_settings(app: tauri::AppHandle, settings: Value) -> Result<(), String> {
    if !settings.is_object() {
        return Err("设置内容必须是 JSON 对象。".to_string());
    }

    save_json(app, APP_SETTINGS_KEY, settings)
}

pub fn clear_app_settings(app: tauri::AppHandle) -> Result<(), String> {
    clear_key(app, APP_SETTINGS_KEY)
}

fn unix_millis_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
