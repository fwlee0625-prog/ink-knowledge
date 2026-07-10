use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{Emitter, Manager};

const EVENT_APP_SETTINGS_CHANGED: &str = "app-settings-changed";

pub use crate::clipboard_repo::{ClipboardHistoryItem, ClipboardRepoConfig};
pub use crate::extensions::{ExtensionInfo, InstallExtensionRequest, UninstallExtensionRequest};
pub use crate::shortcuts::ShortcutBindings;
pub use crate::storage::{
    ClearStorageCacheRequest, ClearStorageCacheResponse, StorageUsageRequest, StorageUsageResponse,
};
pub use crate::update::AppUpdateStatus;
pub use crate::{
    clipboard::{ClipboardTextResponse, ClipboardWriteRequest},
    clipboard_window::ClipboardWindowResponse,
    native_capture::{NativeCaptureRequest, NativeCaptureResponse},
    ocr_result_window::{OcrResultWindowPayload, OcrResultWindowRequest, OcrResultWindowResponse},
    screenshot::{
        CaptureRequest, CopyScreenshotRequest, SaveScreenshotRequest, SaveScreenshotResponse,
        ScreenshotResponse,
    },
    screenshot_ocr::{ScreenshotOcrRequest, ScreenshotOcrResponse},
    translation::{TranslateRequest, TranslateResponse},
    translation_window::TranslationWindowResponse,
};

#[derive(Debug, Serialize)]
pub struct BackendStatus {
    pub ready: bool,
    pub backend_bin: Option<String>,
    pub app_data_dir: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct OcrRequest {
    pub input_path: String,
    pub output_dir: Option<String>,
    pub output_format: Option<String>,
    pub ocr_engine: Option<String>,
    pub dpi: Option<u16>,
    pub lang: Option<String>,
    pub force_ocr: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ClearOcrOutputRequest {
    pub output_dir: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ClearOcrOutputResponse {
    pub removed: usize,
}

#[derive(Debug, Deserialize)]
pub struct ScanFilesRequest {
    pub root_dir: String,
    pub max_depth: Option<u8>,
}

#[derive(Debug, Deserialize)]
pub struct ResultFileRequest {
    pub path: String,
}

#[derive(Debug, Serialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Serialize)]
pub struct ResultPreview {
    pub path: String,
    pub name: String,
    pub extension: String,
    pub content: String,
    pub size: u64,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
pub struct DefaultSettings {
    pub output_dir: String,
    pub screenshot_output_dir: String,
    pub ocr_engine: String,
    pub dpi: u16,
    pub lang: String,
    pub force_ocr: bool,
    pub output_txt: bool,
    pub output_json: bool,
    pub recursion_depth: u8,
}

#[derive(Debug, Deserialize)]
pub struct ClipboardUseItemRequest {
    pub id: String,
}

#[derive(Debug, Serialize)]
pub struct OcrResponse {
    pub json_path: Option<String>,
    pub txt_path: Option<String>,
    pub payload: Value,
    pub stdout: String,
}

#[tauri::command]
pub async fn check_backend(app: tauri::AppHandle) -> Result<BackendStatus, String> {
    run_blocking(move || crate::backend::check_backend(app)).await
}

#[tauri::command]
pub fn get_app_update_status(
    state: tauri::State<'_, crate::update::UpdateState>,
) -> AppUpdateStatus {
    state.status()
}

#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> AppUpdateStatus {
    crate::update::check_and_store(app).await
}

#[tauri::command]
pub async fn list_extensions(app: tauri::AppHandle) -> Result<Vec<ExtensionInfo>, String> {
    run_blocking(move || crate::extensions::list_extensions(app)).await
}

#[tauri::command]
pub async fn install_extension_from_dir(
    app: tauri::AppHandle,
    request: InstallExtensionRequest,
) -> Result<ExtensionInfo, String> {
    run_blocking(move || crate::extensions::install_extension_from_dir(app, request)).await
}

#[tauri::command]
pub async fn uninstall_extension(
    app: tauri::AppHandle,
    request: UninstallExtensionRequest,
) -> Result<Vec<ExtensionInfo>, String> {
    run_blocking(move || crate::extensions::uninstall_extension(app, request)).await
}

#[tauri::command]
pub async fn run_ocr(app: tauri::AppHandle, request: OcrRequest) -> Result<OcrResponse, String> {
    run_blocking(move || crate::backend::run_ocr(app, request)).await
}

#[tauri::command]
pub async fn clear_ocr_output_dir(
    app: tauri::AppHandle,
    request: ClearOcrOutputRequest,
) -> Result<ClearOcrOutputResponse, String> {
    run_blocking(move || crate::backend::clear_ocr_output_dir(app, request)).await
}

#[tauri::command]
pub async fn get_default_settings(app: tauri::AppHandle) -> Result<DefaultSettings, String> {
    run_blocking(move || crate::backend::get_default_settings(app)).await
}

#[tauri::command]
pub async fn load_app_settings(app: tauri::AppHandle) -> Result<Option<Value>, String> {
    run_blocking(move || crate::settings_repo::load_app_settings(app)).await
}

#[tauri::command]
pub async fn save_app_settings(app: tauri::AppHandle, settings: Value) -> Result<(), String> {
    run_blocking({
        let app = app.clone();
        move || crate::settings_repo::save_app_settings(app, settings)
    })
    .await?;
    let _ = app.emit(EVENT_APP_SETTINGS_CHANGED, ());
    Ok(())
}

#[tauri::command]
pub async fn clear_app_settings(app: tauri::AppHandle) -> Result<(), String> {
    run_blocking(move || crate::settings_repo::clear_app_settings(app)).await
}

#[tauri::command]
pub async fn scan_supported_files(request: ScanFilesRequest) -> Result<Vec<String>, String> {
    run_blocking(move || crate::backend::scan_supported_files(request)).await
}

#[tauri::command]
pub async fn preview_result_file(request: ResultFileRequest) -> Result<ResultPreview, String> {
    run_blocking(move || read_result_preview(request)).await
}

#[tauri::command]
pub async fn get_file_info(request: ResultFileRequest) -> Result<FileInfo, String> {
    run_blocking(move || read_file_info(request)).await
}

#[tauri::command]
pub async fn open_result_file(request: ResultFileRequest) -> Result<(), String> {
    run_blocking(move || open_path(PathBuf::from(request.path))).await
}

#[tauri::command]
pub async fn reveal_result_file(request: ResultFileRequest) -> Result<(), String> {
    run_blocking(move || reveal_path(PathBuf::from(request.path))).await
}

#[tauri::command]
pub async fn capture_region(
    app: tauri::AppHandle,
    request: CaptureRequest,
) -> Result<ScreenshotResponse, String> {
    run_blocking(move || crate::native_capture::capture_native_region(app, request.output_dir))
        .await
}

#[tauri::command]
pub async fn save_screenshot(
    app: tauri::AppHandle,
    request: SaveScreenshotRequest,
) -> Result<SaveScreenshotResponse, String> {
    run_blocking(move || crate::screenshot::save_screenshot(app, request)).await
}

#[tauri::command]
pub async fn copy_screenshot(request: CopyScreenshotRequest) -> Result<(), String> {
    run_blocking(move || crate::screenshot::copy_screenshot(request)).await
}

#[tauri::command]
pub async fn run_screenshot_ocr(
    app: tauri::AppHandle,
    request: ScreenshotOcrRequest,
) -> Result<ScreenshotOcrResponse, String> {
    run_blocking(move || crate::screenshot_ocr::run_screenshot_ocr(app, request)).await
}

#[tauri::command]
pub async fn open_ocr_result_window(
    app: tauri::AppHandle,
    request: OcrResultWindowRequest,
) -> Result<OcrResultWindowResponse, String> {
    run_blocking(move || crate::ocr_result_window::open_ocr_result_window(&app, request)).await
}

#[tauri::command]
pub async fn get_pending_ocr_result() -> Result<Option<OcrResultWindowPayload>, String> {
    run_blocking(crate::ocr_result_window::pending_ocr_result).await
}

#[tauri::command]
pub async fn open_translation_window(
    app: tauri::AppHandle,
) -> Result<TranslationWindowResponse, String> {
    run_blocking(move || crate::translation_window::open_translation_window(&app)).await
}

#[tauri::command]
pub async fn open_clipboard_window(
    app: tauri::AppHandle,
) -> Result<ClipboardWindowResponse, String> {
    run_blocking(move || crate::clipboard_window::open_clipboard_window(&app)).await
}

#[tauri::command]
pub async fn set_floating_window_auto_close(label: String, enabled: bool) -> Result<(), String> {
    crate::floating_window::set_auto_close_enabled(&label, enabled)
}

#[tauri::command]
pub async fn translate_text(request: TranslateRequest) -> Result<TranslateResponse, String> {
    run_blocking(move || crate::translation::translate_text(request)).await
}

#[tauri::command]
pub async fn read_clipboard_text() -> Result<ClipboardTextResponse, String> {
    run_blocking(crate::clipboard::read_clipboard_text).await
}

#[tauri::command]
pub async fn write_clipboard_text(
    app: tauri::AppHandle,
    request: ClipboardWriteRequest,
) -> Result<(), String> {
    run_blocking(move || {
        crate::clipboard::write_clipboard_text(request.clone())?;
        // 同步写入剪贴板历史 DB（source 来自前端，默认 manual）
        let state = app.state::<crate::native_pasteboard::PasteboardState>();
        let text = request.text.trim().to_string();
        if text.is_empty() {
            return Ok(());
        }
        let item = ClipboardHistoryItem {
            id: format!(
                "manual-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0)
            ),
            kind: "text".to_string(),
            text: Some(text),
            image_path: None,
            paths: None,
            size_bytes: None,
            mime_type: Some("text/plain".to_string()),
            is_dir: None,
            file_count: None,
            source: request.source.unwrap_or_else(|| "manual".to_string()),
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis().to_string())
                .unwrap_or_else(|_| "0".to_string()),
            pinned: false,
            expired: false,
        };
        state.repo.insert(item)
    })
    .await
}

#[tauri::command]
pub async fn use_clipboard_item(
    app: tauri::AppHandle,
    request: ClipboardUseItemRequest,
) -> Result<(), String> {
    run_blocking(move || {
        let state = app.state::<crate::native_pasteboard::PasteboardState>();
        let item = state
            .repo
            .get(request.id.trim())?
            .ok_or_else(|| "剪贴板记录不存在。".to_string())?;

        match item.kind.as_str() {
            "text" => {
                let text = item.text.as_deref().unwrap_or("").to_string();
                if text.trim().is_empty() {
                    return Err("这条文本记录为空，无法使用。".to_string());
                }
                crate::clipboard::write_clipboard_text(ClipboardWriteRequest {
                    text,
                    source: Some("clipboard".to_string()),
                })?;
            }
            "image" => {
                let path = item
                    .image_path
                    .as_deref()
                    .ok_or_else(|| "这条图片记录没有可使用的图片路径。".to_string())?;
                crate::clipboard::write_clipboard_image(Path::new(path))?;
            }
            "files" => {
                let paths = item
                    .paths
                    .as_ref()
                    .ok_or_else(|| "这条文件记录没有可使用的路径。".to_string())?;
                crate::clipboard::write_clipboard_files(paths)?;
            }
            _ => return Err("暂不支持使用这类剪贴板记录。".to_string()),
        }

        state.repo.touch(&item.id, &unix_millis_string())?;
        state.suppress_next_change();
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn list_clipboard_history(
    app: tauri::AppHandle,
    limit: Option<usize>,
) -> Result<Vec<ClipboardHistoryItem>, String> {
    let state = app.state::<crate::native_pasteboard::PasteboardState>();
    let limit = limit.unwrap_or(500);
    state.repo.list(limit)
}

#[tauri::command]
pub async fn delete_clipboard_item(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let state = app.state::<crate::native_pasteboard::PasteboardState>();
    state.repo.delete(&id)
}

#[tauri::command]
pub async fn clear_clipboard_history(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<crate::native_pasteboard::PasteboardState>();
    state.repo.clear_all()
}

#[tauri::command]
pub async fn set_clipboard_pinned(
    app: tauri::AppHandle,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    let state = app.state::<crate::native_pasteboard::PasteboardState>();
    state.repo.set_pinned(&id, pinned)
}

#[tauri::command]
pub async fn refresh_clipboard_expired(app: tauri::AppHandle) -> Result<usize, String> {
    let state = app.state::<crate::native_pasteboard::PasteboardState>();
    state.repo.refresh_expired()
}

#[tauri::command]
pub async fn set_clipboard_polling(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let state = app.state::<crate::native_pasteboard::PasteboardState>();
    state.set_polling(enabled);
    Ok(())
}

#[tauri::command]
pub async fn update_clipboard_config(
    app: tauri::AppHandle,
    config: ClipboardRepoConfig,
) -> Result<(), String> {
    let state = app.state::<crate::native_pasteboard::PasteboardState>();
    state.update_config(config)
}

#[tauri::command]
pub async fn start_native_capture(
    app: tauri::AppHandle,
    request: NativeCaptureRequest,
) -> Result<NativeCaptureResponse, String> {
    run_blocking(move || crate::native_capture::start_native_capture(app, request)).await
}

#[tauri::command]
pub async fn get_default_shortcut_bindings() -> Result<ShortcutBindings, String> {
    Ok(crate::shortcuts::default_bindings())
}

#[tauri::command]
pub async fn register_shortcuts(
    app: tauri::AppHandle,
    bindings: ShortcutBindings,
) -> Result<(), String> {
    // register_all 只调用快捷键和菜单 API，本身不会阻塞；直接在命令线程执行即可。
    crate::shortcuts::register_all(&app, &bindings)
}

#[tauri::command]
pub async fn get_storage_usage(
    app: tauri::AppHandle,
    request: StorageUsageRequest,
) -> Result<StorageUsageResponse, String> {
    run_blocking(move || crate::storage::collect_storage_usage(app, request)).await
}

#[tauri::command]
pub async fn clear_storage_cache(
    app: tauri::AppHandle,
    request: ClearStorageCacheRequest,
) -> Result<ClearStorageCacheResponse, String> {
    run_blocking(move || crate::storage::clear_storage_cache(app, request)).await
}

async fn run_blocking<T, F>(task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("后台任务执行失败: {error}"))?
}

fn read_result_preview(request: ResultFileRequest) -> Result<ResultPreview, String> {
    const PREVIEW_LIMIT: u64 = 512 * 1024;

    let path = PathBuf::from(request.path.trim());
    if !path.exists() {
        return Err(format!("结果文件不存在: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("不是可预览文件: {}", path.display()));
    }

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "txt" | "json") {
        return Err(format!("当前仅支持预览 txt/json 文件: {}", path.display()));
    }

    let metadata = path
        .metadata()
        .map_err(|error| format!("读取结果文件信息失败: {error}"))?;
    let size = metadata.len();
    let mut file = File::open(&path).map_err(|error| format!("打开结果文件失败: {error}"))?;
    let mut buffer = Vec::new();
    file.by_ref()
        .take(PREVIEW_LIMIT + 1)
        .read_to_end(&mut buffer)
        .map_err(|error| format!("读取结果文件失败: {error}"))?;

    let truncated = buffer.len() as u64 > PREVIEW_LIMIT;
    if truncated {
        buffer.truncate(PREVIEW_LIMIT as usize);
    }

    Ok(ResultPreview {
        path: path.display().to_string(),
        name: file_name(&path),
        extension,
        content: String::from_utf8_lossy(&buffer).to_string(),
        size,
        truncated,
    })
}

fn unix_millis_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string()
}

fn read_file_info(request: ResultFileRequest) -> Result<FileInfo, String> {
    let path = PathBuf::from(request.path.trim());
    if !path.exists() {
        return Err(format!("文件不存在: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("不是文件: {}", path.display()));
    }

    let metadata = path
        .metadata()
        .map_err(|error| format!("读取文件信息失败: {error}"))?;

    Ok(FileInfo {
        path: path.display().to_string(),
        name: file_name(&path),
        size: metadata.len(),
    })
}

fn open_path(path: PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("文件不存在: {}", path.display()));
    }
    run_open_command(open_command(&path)?)
}

fn reveal_path(path: PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("文件不存在: {}", path.display()));
    }
    run_open_command(reveal_command(&path)?)
}

fn run_open_command(mut command: Command) -> Result<(), String> {
    let output = command
        .output()
        .map_err(|error| format!("启动系统打开命令失败: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

#[cfg(target_os = "macos")]
fn open_command(path: &Path) -> Result<Command, String> {
    let mut command = Command::new("open");
    command.arg(path);
    Ok(command)
}

#[cfg(target_os = "macos")]
fn reveal_command(path: &Path) -> Result<Command, String> {
    let mut command = Command::new("open");
    command.arg("-R").arg(path);
    Ok(command)
}

#[cfg(target_os = "windows")]
fn open_command(path: &Path) -> Result<Command, String> {
    let mut command = Command::new("cmd");
    command.arg("/C").arg("start").arg("").arg(path);
    Ok(command)
}

#[cfg(target_os = "windows")]
fn reveal_command(path: &Path) -> Result<Command, String> {
    let mut command = Command::new("explorer");
    command.arg(format!("/select,{}", path.display()));
    Ok(command)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_command(path: &Path) -> Result<Command, String> {
    let mut command = Command::new("xdg-open");
    command.arg(path);
    Ok(command)
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_command(path: &Path) -> Result<Command, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法定位父目录: {}", path.display()))?;
    let mut command = Command::new("xdg-open");
    command.arg(parent);
    Ok(command)
}
