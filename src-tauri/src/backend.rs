use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};

use crate::commands::{
    BackendStatus, ClearOcrOutputRequest, ClearOcrOutputResponse, DefaultSettings, OcrRequest,
    OcrResponse, ScanFilesRequest,
};
use crate::paths::app_data_dir;
use tauri::Manager;

const NATIVE_BACKEND_BIN: &str = "moshi-ocr-native";

pub fn check_backend(app: tauri::AppHandle) -> Result<BackendStatus, String> {
    let app_data = app_data_dir(&app)?;
    let native_backend = resolve_native_backend(&app);
    let paddle_backend = crate::extensions::resolve_extension_entry(&app_data, "paddle").ok();

    match native_backend {
        Some(path) => {
            let output = Command::new(&path).arg("--help").output();
            match output {
                Ok(result) if result.status.success() => {
                    let paddle_message = if let Some(paddle) = paddle_backend {
                        format!("PaddleOCR 扩展已安装: {}", paddle.display())
                    } else {
                        "PaddleOCR 扩展未安装".to_string()
                    };
                    Ok(BackendStatus {
                        ready: true,
                        backend_bin: Some(path.display().to_string()),
                        app_data_dir: app_data.display().to_string(),
                        message: format!("原生 Apple Vision 后端可用；{paddle_message}"),
                    })
                }
                Ok(result) => Ok(BackendStatus {
                    ready: false,
                    backend_bin: Some(path.display().to_string()),
                    app_data_dir: app_data.display().to_string(),
                    message: format!(
                        "原生后端存在但不可运行: {}{}",
                        String::from_utf8_lossy(&result.stdout),
                        String::from_utf8_lossy(&result.stderr)
                    ),
                }),
                Err(error) => Ok(BackendStatus {
                    ready: false,
                    backend_bin: Some(path.display().to_string()),
                    app_data_dir: app_data.display().to_string(),
                    message: format!("原生后端启动失败: {error}"),
                }),
            }
        }
        None => Ok(BackendStatus {
            ready: false,
            backend_bin: None,
            app_data_dir: app_data.display().to_string(),
            message: "未找到内置原生 OCR 后端，请重新构建或安装 App".to_string(),
        }),
    }
}

pub fn get_default_settings(app: tauri::AppHandle) -> Result<DefaultSettings, String> {
    let documents_dir = app
        .path()
        .document_dir()
        .map_err(|error| format!("无法获取文稿目录: {error}"))?;
    let output_dir = documents_dir.join("墨识").join("OCR");
    fs::create_dir_all(&output_dir).map_err(|error| format!("创建默认存储目录失败: {error}"))?;
    let screenshot_output_dir = documents_dir.join("墨识").join("Screenshots");
    fs::create_dir_all(&screenshot_output_dir)
        .map_err(|error| format!("创建默认截图目录失败: {error}"))?;

    Ok(DefaultSettings {
        output_dir: output_dir.display().to_string(),
        screenshot_output_dir: screenshot_output_dir.display().to_string(),
        ocr_engine: "apple-vision".to_string(),
        dpi: 300,
        lang: "ch".to_string(),
        force_ocr: false,
        output_txt: true,
        output_json: false,
        recursion_depth: 1,
    })
}

pub fn scan_supported_files(request: ScanFilesRequest) -> Result<Vec<String>, String> {
    let root = PathBuf::from(request.root_dir.trim());
    if !root.exists() {
        return Err(format!("文件夹不存在: {}", root.display()));
    }
    if !root.is_dir() {
        return Err(format!("不是文件夹: {}", root.display()));
    }

    let max_depth = request.max_depth.unwrap_or(1).clamp(1, 5);
    let mut files = Vec::new();
    collect_supported_files(&root, 0, max_depth, &mut files)?;
    files.sort();
    Ok(files
        .into_iter()
        .map(|path| path.display().to_string())
        .collect())
}

pub fn run_ocr(app: tauri::AppHandle, request: OcrRequest) -> Result<OcrResponse, String> {
    let app_data = app_data_dir(&app)?;
    let input = PathBuf::from(&request.input_path);
    if !input.exists() {
        return Err(format!("输入文件不存在: {}", input.display()));
    }

    let output_dir = resolve_ocr_output_dir(&app_data, request.output_dir.as_deref());
    fs::create_dir_all(&output_dir).map_err(|error| error.to_string())?;

    let dpi = request.dpi.unwrap_or(300).to_string();
    let ocr_engine = normalize_ocr_engine(request.ocr_engine.as_deref())?;
    let lang = request.lang.unwrap_or_else(|| "ch".to_string());
    let output_format = normalize_output_format(request.output_format.as_deref())?;
    let command_format = if output_format == "txt" {
        "both"
    } else {
        output_format
    };
    let backend = resolve_engine_backend(&app, &app_data, ocr_engine)?;

    let mut command = Command::new(&backend);
    command
        .arg("recognize")
        .arg(&input)
        .arg("--output-dir")
        .arg(&output_dir)
        .arg("--format")
        .arg(command_format)
        .arg("--engine")
        .arg(ocr_engine)
        .arg("--dpi")
        .arg(dpi)
        .arg("--lang")
        .arg(lang);

    if request.force_ocr.unwrap_or(false) {
        command.arg("--force-ocr");
    }

    if ocr_engine == "paddle" {
        let model_cache = app_data.join("models").join("paddle");
        fs::create_dir_all(&model_cache).map_err(|error| error.to_string())?;
        command
            .env("PADDLE_PDX_CACHE_HOME", &model_cache)
            .env("PADDLEX_HOME", &model_cache);
    }

    let output = command
        .output()
        .map_err(|error| format!("启动 OCR 后端失败: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        return Err(format!("{stdout}\n{stderr}"));
    }

    let stem = input
        .file_stem()
        .ok_or_else(|| "无法解析输入文件名".to_string())?;
    let json_path = output_dir.join(stem).with_extension("json");
    let txt_path = output_dir.join(stem).with_extension("txt");
    let payload = read_json(&json_path)?;
    let keep_json = output_format != "txt";
    if !keep_json && json_path.exists() {
        fs::remove_file(&json_path)
            .map_err(|error| format!("删除临时 JSON 输出失败 {}: {error}", json_path.display()))?;
    }

    Ok(OcrResponse {
        json_path: keep_json.then(|| json_path.display().to_string()),
        txt_path: txt_path.exists().then(|| txt_path.display().to_string()),
        payload,
        stdout,
    })
}

pub fn clear_ocr_output_dir(
    app: tauri::AppHandle,
    request: ClearOcrOutputRequest,
) -> Result<ClearOcrOutputResponse, String> {
    let app_data = app_data_dir(&app)?;
    let output_dir = resolve_ocr_output_dir(&app_data, request.output_dir.as_deref());
    if !output_dir.exists() {
        return Ok(ClearOcrOutputResponse { removed: 0 });
    }
    if !output_dir.is_dir() {
        return Err(format!("OCR 存储路径不是文件夹: {}", output_dir.display()));
    }

    let mut removed = 0;
    let entries = fs::read_dir(&output_dir)
        .map_err(|error| format!("读取 OCR 存储目录失败 {}: {error}", output_dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 OCR 存储目录条目失败: {error}"))?;
        let path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|error| format!("读取 OCR 输出文件信息失败 {}: {error}", path.display()))?;
        if metadata.is_file() && is_ocr_output_file(&path) {
            fs::remove_file(&path)
                .map_err(|error| format!("删除 OCR 输出文件失败 {}: {error}", path.display()))?;
            removed += 1;
        }
    }

    Ok(ClearOcrOutputResponse { removed })
}

fn resolve_ocr_output_dir(app_data: &Path, output_dir: Option<&str>) -> PathBuf {
    output_dir
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| app_data.join("output"))
}

fn is_ocr_output_file(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(extension.to_ascii_lowercase().as_str(), "txt" | "json")
}

fn normalize_output_format(value: Option<&str>) -> Result<&'static str, String> {
    match value.unwrap_or("txt").trim().to_ascii_lowercase().as_str() {
        "txt" => Ok("txt"),
        "json" => Ok("json"),
        "both" => Ok("both"),
        other => Err(format!("不支持的输出格式: {other}")),
    }
}

fn normalize_ocr_engine(value: Option<&str>) -> Result<&'static str, String> {
    match value
        .unwrap_or("apple-vision")
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-")
        .as_str()
    {
        "paddle" | "paddleocr" => Ok("paddle"),
        "apple" | "vision" | "applevision" | "apple-vision" => Ok("apple-vision"),
        other => Err(format!("不支持的 OCR 引擎: {other}")),
    }
}

fn resolve_engine_backend(
    app: &tauri::AppHandle,
    app_data: &Path,
    engine: &str,
) -> Result<PathBuf, String> {
    match engine {
        "apple-vision" => resolve_native_backend(app)
            .ok_or_else(|| "未找到内置原生 Apple Vision 后端".to_string()),
        "paddle" => crate::extensions::resolve_extension_entry(app_data, "paddle")
            .map_err(|_| "PaddleOCR 扩展未安装。请先在扩展管理中安装 PaddleOCR 后端。".to_string()),
        other => Err(format!("不支持的 OCR 引擎: {other}")),
    }
}

fn resolve_native_backend(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(value) = env::var("MOSHI_OCR_NATIVE_BIN") {
        let path = PathBuf::from(value);
        if path.exists() {
            return Some(path);
        }
    }

    #[cfg(debug_assertions)]
    if let Ok(root) = crate::paths::backend_root() {
        let helper = root
            .join("apple-vision")
            .join("bin")
            .join(NATIVE_BACKEND_BIN);
        if helper.exists() {
            return Some(helper);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        for relative in [
            PathBuf::from(NATIVE_BACKEND_BIN),
            Path::new("apple-vision")
                .join("bin")
                .join(NATIVE_BACKEND_BIN),
            Path::new("_up_")
                .join("apple-vision")
                .join("bin")
                .join(NATIVE_BACKEND_BIN),
        ] {
            let helper = resource_dir.join(relative);
            if helper.exists() {
                return Some(helper);
            }
        }
    }

    #[cfg(debug_assertions)]
    if let Some(path) = crate::paths::which(NATIVE_BACKEND_BIN) {
        return Some(path);
    }

    None
}

fn collect_supported_files(
    dir: &Path,
    depth: u8,
    max_depth: u8,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let entries =
        fs::read_dir(dir).map_err(|error| format!("读取文件夹失败 {}: {error}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取文件夹条目失败: {error}"))?;
        let path = entry.path();
        if path.is_file() && is_supported_file(&path) {
            files.push(path);
        } else if path.is_dir() && depth < max_depth {
            collect_supported_files(&path, depth + 1, max_depth, files)?;
        }
    }
    Ok(())
}

fn is_supported_file(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "pdf" | "png" | "jpg" | "jpeg" | "webp" | "bmp" | "tif" | "tiff" | "heic" | "heif"
    )
}

fn read_json(path: &Path) -> Result<Value, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("读取 JSON 输出失败 {}: {error}", path.display()))?;
    serde_json::from_str(&content).map_err(|error| format!("解析 JSON 输出失败: {error}"))
}
