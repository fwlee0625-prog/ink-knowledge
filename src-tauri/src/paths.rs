use std::path::PathBuf;

#[cfg(debug_assertions)]
use std::{env, ffi::OsString, path::Path};

use tauri::Manager;

pub fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("无法获取 App 数据目录: {error}"))
}

#[cfg(debug_assertions)]
pub fn backend_root() -> Result<PathBuf, String> {
    if let Ok(value) = env::var("MAC_LOCAL_OCR_ROOT") {
        return Ok(PathBuf::from(value));
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "无法定位项目根目录".to_string())
}

#[cfg(debug_assertions)]
pub fn which(binary: &str) -> Option<PathBuf> {
    let paths: OsString = env::var_os("PATH")?;
    for path in env::split_paths(&paths) {
        let candidate = path.join(binary);
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}
