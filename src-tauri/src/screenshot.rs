use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::paths::app_data_dir;
use tauri::Manager;

#[derive(Debug, Deserialize)]
pub struct CaptureRequest {
    pub output_dir: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ScreenshotResponse {
    pub image_path: String,
    pub file_name: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
pub struct SaveScreenshotRequest {
    pub source_path: String,
    pub output_dir: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SaveScreenshotResponse {
    pub image_path: String,
    pub file_name: String,
}

#[derive(Debug, Deserialize)]
pub struct CopyScreenshotRequest {
    pub image_path: String,
}

pub fn save_screenshot(
    app: tauri::AppHandle,
    request: SaveScreenshotRequest,
) -> Result<SaveScreenshotResponse, String> {
    let source = PathBuf::from(request.source_path.trim());
    ensure_image_file(&source)?;

    let output_dir = screenshot_output_dir(&app, request.output_dir.as_deref())?;
    let target = unique_target_path(
        &output_dir,
        source.file_name().and_then(|value| value.to_str()),
    );
    fs::copy(&source, &target).map_err(|error| format!("保存截图失败: {error}"))?;

    Ok(SaveScreenshotResponse {
        file_name: file_name(&target),
        image_path: target.display().to_string(),
    })
}

pub fn copy_screenshot(request: CopyScreenshotRequest) -> Result<(), String> {
    let path = PathBuf::from(request.image_path.trim());
    ensure_image_file(&path)?;

    let script = r#"
on run argv
  set imageFile to POSIX file (item 1 of argv)
  set the clipboard to (read imageFile as «class PNGf»)
end run
"#;
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .arg(path.display().to_string())
        .output()
        .map_err(|error| format!("复制截图失败: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "复制截图失败: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

pub fn screenshot_output_dir(
    app: &tauri::AppHandle,
    output_dir: Option<&str>,
) -> Result<PathBuf, String> {
    let dir = output_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| default_screenshot_output_dir(app));
    fs::create_dir_all(&dir).map_err(|error| format!("创建截图目录失败: {error}"))?;
    Ok(dir)
}

fn default_screenshot_output_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .map(|dir| dir.join("墨识").join("Screenshots"))
        .or_else(|_| app_data_dir(app).map(|dir| dir.join("screenshots")))
        .unwrap_or_else(|_| std::env::temp_dir().join("moshi-screenshots"))
}

pub fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default()
}

pub fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("screenshot.png")
        .to_string()
}

fn ensure_image_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("截图文件不存在: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("不是截图文件: {}", path.display()));
    }
    Ok(())
}

fn unique_target_path(output_dir: &Path, preferred_name: Option<&str>) -> PathBuf {
    let name = preferred_name
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("screenshot-{}.png", timestamp_millis()));
    let target = output_dir.join(&name);
    if !target.exists() {
        return target;
    }

    let stem = Path::new(&name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("screenshot");
    let extension = Path::new(&name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    output_dir.join(format!("{stem}-{}.{}", timestamp_millis(), extension))
}
