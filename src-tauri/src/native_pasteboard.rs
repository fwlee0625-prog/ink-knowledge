use serde::Deserialize;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

use crate::clipboard_repo::{ClipboardHistoryItem, ClipboardRepo, ClipboardRepoConfig};
use crate::paths::app_data_dir;

const PASTEBOARD_HELPER_BIN: &str = "moshi-pasteboard-reader";
const POLL_INTERVAL_MS: u64 = 800;
const EVENT_CLIPBOARD_CHANGED: &str = "clipboard-changed";

/// Swift helper 输出的 JSON 结构（字段对齐 MoshiPasteboardReader.swift 的驼峰命名）
#[derive(Debug, Deserialize)]
struct PasteboardSnapshot {
    #[allow(dead_code)]
    #[serde(rename = "changeCount")]
    change_count: i64,
    kind: String,
    text: Option<String>,
    #[serde(rename = "imagePath")]
    image_path: Option<String>,
    paths: Option<Vec<String>>,
    #[serde(rename = "sizeBytes")]
    size_bytes: Option<i64>,
    #[serde(rename = "mimeType")]
    mime_type: Option<String>,
    #[serde(rename = "isDir")]
    is_dir: Option<bool>,
    #[serde(rename = "fileCount")]
    file_count: Option<i64>,
}

/// 全局单例：repo + 轮询控制。在 main.rs setup 中初始化。
pub struct PasteboardState {
    pub repo: ClipboardRepo,
    last_change_count: Mutex<i64>,
    polling_enabled: AtomicBool,
    suppress_next_change: AtomicBool,
}

impl PasteboardState {
    pub fn new(app: &AppHandle) -> Result<Self, String> {
        let repo = ClipboardRepo::open(app)?;
        Ok(Self {
            repo,
            last_change_count: Mutex::new(-1),
            polling_enabled: AtomicBool::new(true),
            suppress_next_change: AtomicBool::new(false),
        })
    }

    pub fn set_polling(&self, enabled: bool) {
        self.polling_enabled.store(enabled, Ordering::Relaxed);
    }

    pub fn polling_enabled(&self) -> bool {
        self.polling_enabled.load(Ordering::Relaxed)
    }

    pub fn update_config(&self, config: ClipboardRepoConfig) -> Result<(), String> {
        self.repo.set_config(config)
    }

    pub fn suppress_next_change(&self) {
        self.suppress_next_change.store(true, Ordering::Relaxed);
    }

    fn take_suppress_next_change(&self) -> bool {
        self.suppress_next_change.swap(false, Ordering::Relaxed)
    }
}

/// 解析 helper 路径。优先 macos-capture/bin，回退到项目源码同级。
fn resolve_helper_path() -> Result<PathBuf, String> {
    // 通过 CARGO_MANIFEST_DIR 找到项目根目录下的 macos-capture/bin
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidate = manifest_dir
        .parent()
        .ok_or_else(|| "无法定位项目根目录".to_string())?
        .join("macos-capture")
        .join("bin")
        .join(PASTEBOARD_HELPER_BIN);
    if candidate.exists() {
        return Ok(candidate);
    }
    Err(format!("未找到剪贴板 helper：{}", candidate.display()))
}

/// 启动轮询线程。在 main.rs setup 中调用一次。
/// 用独立 OS 线程而非 tauri::async_runtime，避免依赖 tokio 直接触发。
pub fn start_polling(app: AppHandle) {
    thread::spawn(move || {
        // 给启动一点缓冲，避免阻塞初始化
        thread::sleep(Duration::from_secs(1));
        loop {
            let state = app.state::<PasteboardState>();
            if state.polling_enabled() {
                if let Err(error) = poll_once(&app) {
                    eprintln!("剪贴板轮询失败: {error}");
                }
            }
            thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
        }
    });
}

/// 单次轮询：调 helper 读 changeCount，对比上次值，变化则读内容并入库 + 通知前端。
fn poll_once(app: &AppHandle) -> Result<(), String> {
    let helper_path = resolve_helper_path()?;
    let image_dir = app_image_dir(app)?;

    let output = Command::new(&helper_path)
        .arg("--image-dir")
        .arg(&image_dir)
        .output()
        .map_err(|e| format!("调用剪贴板 helper 失败: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "剪贴板 helper 退出码非 0: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let snapshot: PasteboardSnapshot = serde_json::from_str(stdout.trim())
        .map_err(|e| format!("解析剪贴板 helper 输出失败: {e}"))?;

    let state = app.state::<PasteboardState>();
    let mut last = state
        .last_change_count
        .lock()
        .map_err(|e| format!("锁失败: {e}"))?;
    if snapshot.change_count == *last {
        return Ok(());
    }
    *last = snapshot.change_count;

    if state.take_suppress_next_change() {
        return Ok(());
    }

    // kind=unknown 跳过（不支持的内容类型）
    if snapshot.kind == "unknown" {
        return Ok(());
    }

    // 敏感文本过滤：复制到密码字段时不入库
    if snapshot.kind == "text" {
        if let Some(text) = &snapshot.text {
            if looks_sensitive(text) {
                return Ok(());
            }
        }
    }

    let item = ClipboardHistoryItem {
        id: format!("{}-{}", snapshot.change_count, unix_millis()),
        kind: snapshot.kind,
        text: snapshot.text,
        image_path: snapshot.image_path,
        paths: snapshot.paths,
        size_bytes: snapshot.size_bytes,
        mime_type: snapshot.mime_type,
        is_dir: snapshot.is_dir,
        file_count: snapshot.file_count,
        source: "clipboard".to_string(),
        created_at: unix_millis().to_string(),
        pinned: false,
        expired: false,
    };

    if let Err(error) = state.repo.insert(item) {
        eprintln!("插入剪贴板记录失败: {error}");
        return Ok(());
    }

    // 通知前端刷新
    let _ = app.emit(EVENT_CLIPBOARD_CHANGED, ());
    Ok(())
}

fn app_image_dir(app: &AppHandle) -> Result<String, String> {
    let dir = app_data_dir(app)?.join("clipboard-images");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建图片目录失败: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 敏感文本检测。和前端 looksSensitive 关键字保持一致。
fn looks_sensitive(text: &str) -> bool {
    const KEYWORDS: &[&str] = &[
        "password",
        "passwd",
        "token",
        "secret",
        "api_key",
        "api-key",
        "apikey",
        "authorization",
        "bearer ",
    ];
    let lower = text.to_lowercase();
    KEYWORDS.iter().any(|k| lower.contains(k))
}
