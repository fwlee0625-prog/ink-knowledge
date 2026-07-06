use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, OnceLock,
};
use tauri::{webview::Color, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const OCR_RESULT_WINDOW_LABEL: &str = "ocr-result";
const OCR_RESULT_CLOSE_SHORTCUT: &str = "Escape";

static PENDING_RESULT: OnceLock<Mutex<Option<OcrResultWindowPayload>>> = OnceLock::new();
static CLOSE_SHORTCUT_REGISTERED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct OcrResultWindowRequest {
    pub image_path: String,
    pub recognized_text: String,
    pub items: Option<Value>,
    pub language: Option<String>,
    pub engine: Option<String>,
    pub source: Option<String>,
}

pub type OcrResultWindowPayload = OcrResultWindowRequest;

#[derive(Debug, Serialize)]
pub struct OcrResultWindowResponse {
    pub opened: bool,
    pub message: String,
}

pub fn open_ocr_result_window(
    app: &tauri::AppHandle,
    request: OcrResultWindowRequest,
) -> Result<OcrResultWindowResponse, String> {
    if request.image_path.trim().is_empty() {
        return Err("缺少 OCR 图片路径。".to_string());
    }

    store_pending_result(request.clone())?;

    if let Some(window) = app.get_webview_window(OCR_RESULT_WINDOW_LABEL) {
        let _ = window.set_always_on_top(true);
        let _ = window.set_visible_on_all_workspaces(true);
        let _ = window.unmaximize();
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        register_close_shortcut(app);
        let _ = window.emit("ocr-result-updated", request);
    } else {
        let window = WebviewWindowBuilder::new(
            app,
            OCR_RESULT_WINDOW_LABEL,
            WebviewUrl::App("index.html#/ocr-result".into()),
        )
        .title("截图 OCR 结果")
        .inner_size(940.0, 620.0)
        .min_inner_size(760.0, 480.0)
        .resizable(true)
        .center()
        // 结果窗口是一个真正可拖动的独立窗口。保持聚焦以便点击外部时触发失焦关闭。
        .focused(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .transparent(true)
        .background_color(Color(0, 0, 0, 0))
        // 无标题栏、无系统关闭按钮，前端支持 ESC 关闭。
        .decorations(false)
        .skip_taskbar(true)
        .build()
        .map_err(|error| format!("打开 OCR 结果窗口失败: {error}"))?;

        let app_handle = app.clone();
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                unregister_close_shortcut(&app_handle);
            }
        });

        let _ = window.show();
        let _ = window.set_focus();
        register_close_shortcut(app);
    }

    Ok(OcrResultWindowResponse {
        opened: true,
        message: "OCR 结果窗口已打开。".to_string(),
    })
}

pub fn pending_ocr_result() -> Result<Option<OcrResultWindowPayload>, String> {
    let guard = pending_store()
        .lock()
        .map_err(|_| "读取 OCR 结果缓存失败。".to_string())?;
    Ok(guard.clone())
}

fn store_pending_result(request: OcrResultWindowRequest) -> Result<(), String> {
    let mut guard = pending_store()
        .lock()
        .map_err(|_| "写入 OCR 结果缓存失败。".to_string())?;
    *guard = Some(request);
    Ok(())
}

fn pending_store() -> &'static Mutex<Option<OcrResultWindowPayload>> {
    PENDING_RESULT.get_or_init(|| Mutex::new(None))
}

fn register_close_shortcut(app: &tauri::AppHandle) {
    unregister_close_shortcut(app);

    let manager = app.global_shortcut();
    let result = manager.on_shortcut(OCR_RESULT_CLOSE_SHORTCUT, |handle, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            if let Some(window) = handle.get_webview_window(OCR_RESULT_WINDOW_LABEL) {
                let _ = window.close();
            }
        }
    });

    match result {
        Ok(()) => {
            CLOSE_SHORTCUT_REGISTERED.store(true, Ordering::SeqCst);
        }
        Err(error) => {
            eprintln!("注册 OCR 结果窗口 ESC 关闭快捷键失败: {error}");
        }
    }
}

fn unregister_close_shortcut(app: &tauri::AppHandle) {
    if CLOSE_SHORTCUT_REGISTERED.swap(false, Ordering::SeqCst) {
        let _ = app.global_shortcut().unregister(OCR_RESULT_CLOSE_SHORTCUT);
    }
}
