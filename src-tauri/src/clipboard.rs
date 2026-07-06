use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[derive(Debug, Serialize)]
pub struct ClipboardTextResponse {
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ClipboardWriteRequest {
    pub text: String,
    #[serde(default)]
    pub source: Option<String>,
}

pub fn read_clipboard_text() -> Result<ClipboardTextResponse, String> {
    let output = Command::new("pbpaste")
        .output()
        .map_err(|error| format!("读取剪贴板失败: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "读取剪贴板失败: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(ClipboardTextResponse {
        text: String::from_utf8_lossy(&output.stdout).to_string(),
    })
}

pub fn write_clipboard_text(request: ClipboardWriteRequest) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| format!("写入剪贴板失败: {error}"))?;

    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| "无法打开剪贴板写入通道".to_string())?;
    stdin
        .write_all(request.text.as_bytes())
        .map_err(|error| format!("写入剪贴板失败: {error}"))?;

    let status = child
        .wait()
        .map_err(|error| format!("等待剪贴板写入失败: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("写入剪贴板失败。".to_string())
    }
}

pub fn write_clipboard_image(path: &Path) -> Result<(), String> {
    ensure_file(path, "剪贴板图片")?;

    let script = r#"
on run argv
  set imageFile to POSIX file (item 1 of argv)
  set the clipboard to (read imageFile as «class PNGf»)
end run
"#;
    run_osascript(script, &[path.display().to_string()], "使用剪贴板图片")
}

pub fn write_clipboard_files(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Err("没有可使用的文件路径。".to_string());
    }

    let mut args = Vec::with_capacity(paths.len());
    for path in paths {
        let path = PathBuf::from(path.trim());
        ensure_path(&path, "剪贴板文件")?;
        args.push(path.display().to_string());
    }

    let script = r#"
on run argv
  set fileList to {}
  repeat with filePath in argv
    set end of fileList to (POSIX file filePath)
  end repeat
  set the clipboard to fileList
end run
"#;
    run_osascript(script, &args, "使用剪贴板文件")
}

fn ensure_file(path: &Path, label: &str) -> Result<(), String> {
    ensure_path(path, label)?;
    if !path.is_file() {
        return Err(format!("{label}不是文件: {}", path.display()));
    }
    Ok(())
}

fn ensure_path(path: &Path, label: &str) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("{label}不存在: {}", path.display()));
    }
    Ok(())
}

fn run_osascript(script: &str, args: &[String], action: &str) -> Result<(), String> {
    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .args(args)
        .output()
        .map_err(|error| format!("{action}失败: {error}"))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{action}失败: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}
