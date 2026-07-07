use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

use crate::{native_pasteboard::PasteboardState, paths::app_data_dir};

#[derive(Debug, Deserialize)]
pub struct StorageUsageRequest {
    pub output_dir: Option<String>,
    pub screenshot_output_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ClearStorageCacheRequest {
    pub ids: Vec<String>,
    pub output_dir: Option<String>,
    pub screenshot_output_dir: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StorageUsageItem {
    pub id: String,
    pub label: String,
    pub description: String,
    pub path: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub exists: bool,
}

#[derive(Debug, Serialize)]
pub struct StorageUsageResponse {
    pub total_bytes: u64,
    pub items: Vec<StorageUsageItem>,
    pub generated_at: String,
}

#[derive(Debug, Serialize)]
pub struct ClearStorageCacheResponse {
    pub cleared_ids: Vec<String>,
    pub removed_bytes: u64,
    pub removed_files: u64,
}

#[derive(Default)]
struct PathMeasure {
    size_bytes: u64,
    file_count: u64,
    exists: bool,
}

pub fn collect_storage_usage(
    app: tauri::AppHandle,
    request: StorageUsageRequest,
) -> Result<StorageUsageResponse, String> {
    let app_data = app_data_dir(&app)?;
    let ocr_dir = resolve_dir(request.output_dir.as_deref(), app_data.join("output"));
    let screenshot_dir = resolve_dir(
        request.screenshot_output_dir.as_deref(),
        default_screenshot_dir(&app, &app_data),
    );

    let mut items = cache_items(&app, &app_data, ocr_dir, screenshot_dir)?;

    let total_bytes = items.iter().map(|item| item.size_bytes).sum();
    items.sort_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| a.label.cmp(&b.label))
    });

    Ok(StorageUsageResponse {
        total_bytes,
        items,
        generated_at: unix_millis_string(),
    })
}

pub fn clear_storage_cache(
    app: tauri::AppHandle,
    request: ClearStorageCacheRequest,
) -> Result<ClearStorageCacheResponse, String> {
    let app_data = app_data_dir(&app)?;
    let ocr_dir = resolve_dir(request.output_dir.as_deref(), app_data.join("output"));
    let screenshot_dir = resolve_dir(
        request.screenshot_output_dir.as_deref(),
        default_screenshot_dir(&app, &app_data),
    );

    let mut cleared_ids = Vec::new();
    let mut removed_bytes = 0_u64;
    let mut removed_files = 0_u64;

    for id in request.ids {
        let id = id.trim();
        if id.is_empty() || cleared_ids.iter().any(|cleared| cleared == id) {
            continue;
        }
        let before = measure_cache_target(&app, &app_data, &ocr_dir, &screenshot_dir, id)?;
        clear_cache_target(&app, &app_data, &ocr_dir, &screenshot_dir, id)?;
        cleared_ids.push(id.to_string());
        removed_bytes = removed_bytes.saturating_add(before.size_bytes);
        removed_files = removed_files.saturating_add(before.file_count);
    }

    Ok(ClearStorageCacheResponse {
        cleared_ids,
        removed_bytes,
        removed_files,
    })
}

fn cache_items(
    app: &tauri::AppHandle,
    app_data: &Path,
    ocr_dir: PathBuf,
    screenshot_dir: PathBuf,
) -> Result<Vec<StorageUsageItem>, String> {
    Ok(vec![
        measure_item(
            "ocr",
            "OCR 结果",
            "文件识别和截图 OCR 生成的 txt/json 结果。",
            vec![ocr_dir],
            Some(&["txt", "json"]),
        )?,
        measure_item(
            "screenshot",
            "截图",
            "普通截图与截图 OCR 保存的图片。",
            vec![screenshot_dir],
            Some(&["png", "jpg", "jpeg", "webp"]),
        )?,
        measure_clipboard_item(app, app_data)?,
        measure_item(
            "models",
            "模型缓存",
            "PaddleOCR 等后端运行时下载或生成的模型缓存。",
            vec![app_data.join("models")],
            None,
        )?,
    ])
}

fn measure_clipboard_item(
    app: &tauri::AppHandle,
    app_data: &Path,
) -> Result<StorageUsageItem, String> {
    let image_dir = app_data.join("clipboard-images");
    let paths = if clipboard_history_is_empty(app)? {
        vec![image_dir]
    } else {
        vec![
            app_data.join("clipboard.db"),
            app_data.join("clipboard.db-wal"),
            app_data.join("clipboard.db-shm"),
            image_dir,
        ]
    };

    measure_item(
        "clipboard",
        "剪贴板",
        "剪贴板历史记录和复制图片缓存。",
        paths,
        None,
    )
}

fn clipboard_history_is_empty(app: &tauri::AppHandle) -> Result<bool, String> {
    let Some(state) = app.try_state::<PasteboardState>() else {
        return Ok(false);
    };
    state.repo.is_empty()
}

fn resolve_dir(value: Option<&str>, fallback: PathBuf) -> PathBuf {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or(fallback)
}

fn default_screenshot_dir(app: &tauri::AppHandle, app_data: &Path) -> PathBuf {
    app.path()
        .document_dir()
        .map(|dir| dir.join("墨识").join("Screenshots"))
        .unwrap_or_else(|_| app_data.join("screenshots"))
}

fn measure_item(
    id: &str,
    label: &str,
    description: &str,
    paths: Vec<PathBuf>,
    extensions: Option<&[&str]>,
) -> Result<StorageUsageItem, String> {
    let mut total = PathMeasure::default();
    for path in &paths {
        let measure = if let Some(extensions) = extensions {
            measure_filtered_path(path, extensions)?
        } else {
            measure_path(path)?
        };
        total.size_bytes = total.size_bytes.saturating_add(measure.size_bytes);
        total.file_count = total.file_count.saturating_add(measure.file_count);
        total.exists = total.exists || measure.exists;
    }

    Ok(StorageUsageItem {
        id: id.to_string(),
        label: label.to_string(),
        description: description.to_string(),
        path: paths
            .first()
            .map(|path| path.display().to_string())
            .unwrap_or_default(),
        size_bytes: total.size_bytes,
        file_count: total.file_count,
        exists: total.exists,
    })
}

fn measure_cache_target(
    app: &tauri::AppHandle,
    app_data: &Path,
    ocr_dir: &Path,
    screenshot_dir: &Path,
    id: &str,
) -> Result<PathMeasure, String> {
    match id {
        "ocr" => measure_filtered_path(ocr_dir, &["txt", "json"]),
        "screenshot" => measure_filtered_path(screenshot_dir, &["png", "jpg", "jpeg", "webp"]),
        "clipboard" => measure_clipboard_item(app, app_data).map(|item| PathMeasure {
            size_bytes: item.size_bytes,
            file_count: item.file_count,
            exists: item.exists,
        }),
        "models" => measure_path(&app_data.join("models")),
        other => Err(format!("不支持清理的缓存类型: {other}")),
    }
    .or_else(|error| {
        if id == "clipboard" && app.try_state::<PasteboardState>().is_none() {
            Ok(PathMeasure::default())
        } else {
            Err(error)
        }
    })
}

fn clear_cache_target(
    app: &tauri::AppHandle,
    app_data: &Path,
    ocr_dir: &Path,
    screenshot_dir: &Path,
    id: &str,
) -> Result<(), String> {
    match id {
        "ocr" => remove_filtered_files(ocr_dir, &["txt", "json"]),
        "screenshot" => remove_filtered_files(screenshot_dir, &["png", "jpg", "jpeg", "webp"]),
        "clipboard" => {
            let Some(state) = app.try_state::<PasteboardState>() else {
                return Ok(());
            };
            state.repo.clear_all()
        }
        "models" => remove_dir_contents(&app_data.join("models")),
        other => Err(format!("不支持清理的缓存类型: {other}")),
    }
}

fn measure_filtered_path(path: &Path, extensions: &[&str]) -> Result<PathMeasure, String> {
    if !path.exists() {
        return Ok(PathMeasure::default());
    }
    if path.is_file() {
        let metadata = fs::metadata(path)
            .map_err(|error| format!("读取缓存文件失败 {}: {error}", path.display()))?;
        return Ok(if has_extension(path, extensions) {
            PathMeasure {
                size_bytes: metadata.len(),
                file_count: 1,
                exists: true,
            }
        } else {
            PathMeasure {
                exists: true,
                ..PathMeasure::default()
            }
        });
    }
    if !path.is_dir() {
        return Ok(PathMeasure {
            exists: true,
            ..PathMeasure::default()
        });
    }

    let mut total = PathMeasure {
        exists: true,
        ..PathMeasure::default()
    };
    let entries = fs::read_dir(path)
        .map_err(|error| format!("读取缓存目录失败 {}: {error}", path.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取缓存目录条目失败: {error}"))?;
        let entry_path = entry.path();
        if !entry_path.is_file() || !has_extension(&entry_path, extensions) {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("读取缓存文件失败 {}: {error}", entry_path.display()))?;
        total.size_bytes = total.size_bytes.saturating_add(metadata.len());
        total.file_count = total.file_count.saturating_add(1);
    }
    Ok(total)
}

fn measure_path(path: &Path) -> Result<PathMeasure, String> {
    if !path.exists() {
        return Ok(PathMeasure::default());
    }

    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("读取存储路径失败 {}: {error}", path.display()))?;
    if metadata.is_file() {
        return Ok(PathMeasure {
            size_bytes: metadata.len(),
            file_count: 1,
            exists: true,
        });
    }
    if metadata.file_type().is_symlink() {
        return Ok(PathMeasure {
            size_bytes: metadata.len(),
            file_count: 1,
            exists: true,
        });
    }
    if !metadata.is_dir() {
        return Ok(PathMeasure {
            size_bytes: metadata.len(),
            file_count: 0,
            exists: true,
        });
    }

    let mut total = PathMeasure {
        exists: true,
        ..PathMeasure::default()
    };
    let entries = fs::read_dir(path)
        .map_err(|error| format!("读取存储目录失败 {}: {error}", path.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取存储目录条目失败: {error}"))?;
        let measure = measure_path(&entry.path())?;
        total.size_bytes = total.size_bytes.saturating_add(measure.size_bytes);
        total.file_count = total.file_count.saturating_add(measure.file_count);
    }
    Ok(total)
}

fn remove_filtered_files(path: &Path, extensions: &[&str]) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_file() {
        if has_extension(path, extensions) {
            fs::remove_file(path)
                .map_err(|error| format!("删除缓存文件失败 {}: {error}", path.display()))?;
        }
        return Ok(());
    }
    if !path.is_dir() {
        return Ok(());
    }

    let entries = fs::read_dir(path)
        .map_err(|error| format!("读取缓存目录失败 {}: {error}", path.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取缓存目录条目失败: {error}"))?;
        let entry_path = entry.path();
        if entry_path.is_file() && has_extension(&entry_path, extensions) {
            fs::remove_file(&entry_path)
                .map_err(|error| format!("删除缓存文件失败 {}: {error}", entry_path.display()))?;
        }
    }
    Ok(())
}

fn remove_dir_contents(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    if !path.is_dir() {
        return Ok(());
    }

    let entries = fs::read_dir(path)
        .map_err(|error| format!("读取缓存目录失败 {}: {error}", path.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取缓存目录条目失败: {error}"))?;
        let entry_path = entry.path();
        if entry_path.is_dir() {
            fs::remove_dir_all(&entry_path)
                .map_err(|error| format!("删除缓存目录失败 {}: {error}", entry_path.display()))?;
        } else {
            fs::remove_file(&entry_path)
                .map_err(|error| format!("删除缓存文件失败 {}: {error}", entry_path.display()))?;
        }
    }
    Ok(())
}

fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    let extension = extension.to_ascii_lowercase();
    extensions.iter().any(|item| *item == extension)
}

fn unix_millis_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
