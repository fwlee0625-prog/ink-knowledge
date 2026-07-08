use std::{
    collections::HashSet,
    sync::{Mutex, OnceLock},
};
use tauri::{Manager, WindowEvent};

const OCR_RESULT_LABEL: &str = "ocr-result";
const TRANSLATION_LABEL: &str = "translation";
const CLIPBOARD_LABEL: &str = "clipboard";

static AUTO_CLOSE_LABELS: OnceLock<Mutex<HashSet<&'static str>>> = OnceLock::new();

pub fn set_auto_close_enabled(label: &str, enabled: bool) -> Result<(), String> {
    let label = normalize_label(label).ok_or_else(|| format!("不支持的浮窗: {label}"))?;
    let mut labels = auto_close_labels()
        .lock()
        .map_err(|_| "更新浮窗自动关闭状态失败。".to_string())?;

    if enabled {
        labels.insert(label);
    } else {
        labels.remove(label);
    }

    Ok(())
}

pub fn handle_window_event(app: &tauri::AppHandle, label: &str, event: &WindowEvent) {
    let Some(label) = normalize_label(label) else {
        return;
    };

    match event {
        WindowEvent::Destroyed => clear_auto_close(label),
        WindowEvent::Focused(false) => {
            if is_auto_close_enabled(label) {
                if let Some(window) = app.get_webview_window(label) {
                    let _ = window.close();
                }
            }
        }
        _ => {}
    }
}

fn clear_auto_close(label: &'static str) {
    if let Ok(mut labels) = auto_close_labels().lock() {
        labels.remove(label);
    }
}

fn is_auto_close_enabled(label: &'static str) -> bool {
    auto_close_labels()
        .lock()
        .map(|labels| labels.contains(label))
        .unwrap_or(false)
}

fn auto_close_labels() -> &'static Mutex<HashSet<&'static str>> {
    AUTO_CLOSE_LABELS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn normalize_label(label: &str) -> Option<&'static str> {
    match label {
        OCR_RESULT_LABEL => Some(OCR_RESULT_LABEL),
        TRANSLATION_LABEL => Some(TRANSLATION_LABEL),
        CLIPBOARD_LABEL => Some(CLIPBOARD_LABEL),
        _ => None,
    }
}
