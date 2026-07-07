use serde::Serialize;
use tauri::{webview::Color, Manager, WebviewUrl, WebviewWindowBuilder};

const TRANSLATION_WINDOW_LABEL: &str = "translation";

#[derive(Debug, Serialize)]
pub struct TranslationWindowResponse {
    pub opened: bool,
    pub message: String,
}

pub fn open_translation_window(app: &tauri::AppHandle) -> Result<TranslationWindowResponse, String> {
    if let Some(window) = app.get_webview_window(TRANSLATION_WINDOW_LABEL) {
        let _ = window.set_always_on_top(true);
        let _ = window.set_visible_on_all_workspaces(true);
        let _ = window.unmaximize();
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    } else {
        let window = WebviewWindowBuilder::new(
            app,
            TRANSLATION_WINDOW_LABEL,
            WebviewUrl::App("index.html#/translation".into()),
        )
        .title("翻译")
        .inner_size(940.0, 620.0)
        .min_inner_size(760.0, 480.0)
        .resizable(true)
        .center()
        .focused(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        .decorations(false)
        .skip_taskbar(true)
        .build()
        .map_err(|error| format!("打开翻译窗口失败: {error}"))?;

        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(TranslationWindowResponse {
        opened: true,
        message: "翻译窗口已打开。".to_string(),
    })
}
