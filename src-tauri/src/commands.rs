use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
};

pub use crate::extensions::{ExtensionInfo, InstallExtensionRequest, UninstallExtensionRequest};

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
pub struct ScanFilesRequest {
    pub root_dir: String,
    pub max_depth: Option<u8>,
}

#[derive(Debug, Deserialize)]
pub struct ResultFileRequest {
    pub path: String,
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
    pub ocr_engine: String,
    pub dpi: u16,
    pub lang: String,
    pub force_ocr: bool,
    pub output_txt: bool,
    pub output_json: bool,
    pub recursion_depth: u8,
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
pub async fn get_default_settings(app: tauri::AppHandle) -> Result<DefaultSettings, String> {
    run_blocking(move || crate::backend::get_default_settings(app)).await
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
pub async fn open_result_file(request: ResultFileRequest) -> Result<(), String> {
    run_blocking(move || open_path(PathBuf::from(request.path))).await
}

#[tauri::command]
pub async fn reveal_result_file(request: ResultFileRequest) -> Result<(), String> {
    run_blocking(move || reveal_path(PathBuf::from(request.path))).await
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

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string()
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
