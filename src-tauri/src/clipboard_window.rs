use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    webview::Color, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const CLIPBOARD_WINDOW_LABEL: &str = "clipboard";
const CLIPBOARD_WINDOW_CLOSE_SHORTCUT: &str = "Escape";
const CLIPBOARD_WINDOW_WIDTH: f64 = 1280.0;
const CLIPBOARD_WINDOW_HEIGHT: f64 = 380.0;

static CLOSE_SHORTCUT_REGISTERED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Serialize)]
pub struct ClipboardWindowResponse {
    pub opened: bool,
    pub message: String,
}

pub fn open_clipboard_window(app: &tauri::AppHandle) -> Result<ClipboardWindowResponse, String> {
    if let Some(window) = app.get_webview_window(CLIPBOARD_WINDOW_LABEL) {
        let _ = window.set_always_on_top(true);
        let _ = window.set_visible_on_all_workspaces(true);
        let _ = window.unmaximize();
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        register_close_shortcut(app);
    } else {
        let window = WebviewWindowBuilder::new(
            app,
            CLIPBOARD_WINDOW_LABEL,
            WebviewUrl::App("index.html#/clipboard".into()),
        )
        .title("剪贴板")
        .inner_size(CLIPBOARD_WINDOW_WIDTH, CLIPBOARD_WINDOW_HEIGHT)
        .min_inner_size(960.0, 320.0)
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
        .map_err(|error| format!("打开剪贴板窗口失败: {error}"))?;

        position_clipboard_window(&window);

        let app_handle = app.clone();
        window.on_window_event(move |event| match event {
            WindowEvent::Destroyed => {
                crate::floating_window::handle_window_event(
                    &app_handle,
                    CLIPBOARD_WINDOW_LABEL,
                    event,
                );
                unregister_close_shortcut(&app_handle);
            }
            _ => crate::floating_window::handle_window_event(
                &app_handle,
                CLIPBOARD_WINDOW_LABEL,
                event,
            ),
        });

        let _ = window.show();
        let _ = window.set_focus();
        register_close_shortcut(app);
    }

    Ok(ClipboardWindowResponse {
        opened: true,
        message: "剪贴板窗口已打开。".to_string(),
    })
}

pub fn restore_close_shortcut_if_open(app: &tauri::AppHandle) {
    if app.get_webview_window(CLIPBOARD_WINDOW_LABEL).is_some() {
        register_close_shortcut(app);
    }
}

fn register_close_shortcut(app: &tauri::AppHandle) {
    unregister_close_shortcut(app);

    let manager = app.global_shortcut();
    let result = manager.on_shortcut(
        CLIPBOARD_WINDOW_CLOSE_SHORTCUT,
        |handle, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if let Some(window) = handle.get_webview_window(CLIPBOARD_WINDOW_LABEL) {
                    let _ = window.close();
                }
            }
        },
    );

    match result {
        Ok(()) => {
            CLOSE_SHORTCUT_REGISTERED.store(true, Ordering::SeqCst);
        }
        Err(error) => {
            eprintln!("注册剪贴板窗口 ESC 关闭快捷键失败: {error}");
        }
    }
}

fn unregister_close_shortcut(app: &tauri::AppHandle) {
    if CLOSE_SHORTCUT_REGISTERED.swap(false, Ordering::SeqCst) {
        let _ = app
            .global_shortcut()
            .unregister(CLIPBOARD_WINDOW_CLOSE_SHORTCUT);
    }
}

fn position_clipboard_window(window: &WebviewWindow) {
    let Ok(Some(monitor)) = window
        .current_monitor()
        .or_else(|_| window.primary_monitor())
    else {
        return;
    };

    let work_area = monitor.work_area();
    let scale_factor = monitor.scale_factor();
    let width = (CLIPBOARD_WINDOW_WIDTH * scale_factor).round() as i32;
    let height = (CLIPBOARD_WINDOW_HEIGHT * scale_factor).round() as i32;
    let margin = (28.0 * scale_factor).round() as i32;
    let work_x = work_area.position.x;
    let work_y = work_area.position.y;
    let work_width = work_area.size.width as i32;
    let work_height = work_area.size.height as i32;

    let x = work_x + ((work_width - width) / 2).max(margin);
    let preferred_y = work_y + ((work_height as f64 - height as f64) * 0.62).round() as i32;
    let max_y = work_y + work_height - height - margin;
    let y = preferred_y.clamp(work_y + margin, max_y.max(work_y + margin));

    let _ = window.set_position(PhysicalPosition::new(x, y));
}
