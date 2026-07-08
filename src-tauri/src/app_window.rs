use serde::Serialize;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const OCR_WINDOW_LABEL: &str = "ocr";
const SETTINGS_WINDOW_LABEL: &str = "settings";

#[derive(Debug, Serialize)]
pub struct AppWindowResponse {
    pub opened: bool,
    pub message: String,
}

pub fn open_ocr_window(app: &tauri::AppHandle) -> Result<AppWindowResponse, String> {
    open_app_window(
        app,
        OCR_WINDOW_LABEL,
        "墨识 OCR",
        "index.html#/ocr",
        1240.0,
        760.0,
        1120.0,
        720.0,
    )
    .map(|_| AppWindowResponse {
        opened: true,
        message: "OCR 窗口已打开。".to_string(),
    })
}

pub fn open_settings_window(app: &tauri::AppHandle) -> Result<AppWindowResponse, String> {
    open_app_window(
        app,
        SETTINGS_WINDOW_LABEL,
        "墨识设置",
        "index.html#/settings",
        1120.0,
        720.0,
        980.0,
        640.0,
    )
    .map(|_| AppWindowResponse {
        opened: true,
        message: "设置窗口已打开。".to_string(),
    })
}

fn open_app_window(
    app: &tauri::AppHandle,
    label: &str,
    title: &str,
    route: &str,
    width: f64,
    height: f64,
    min_width: f64,
    min_height: f64,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.unmaximize();
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, label, WebviewUrl::App(route.into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(min_width, min_height)
        .resizable(true)
        .center()
        .focused(true)
        .skip_taskbar(true)
        .build()
        .map_err(|error| format!("打开{title}失败: {error}"))?;

    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}
