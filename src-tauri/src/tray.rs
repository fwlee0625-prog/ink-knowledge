use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::shortcuts::ShortcutBindings;

const EVENT_OPEN_VIEW: &str = "tray-open-view";
const MAIN_WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "moshi-main";

/// 菜单项 ID 与 shortcut action ID 共用，便于菜单事件和全局快捷键走同一分发路径。
const ACTION_OCR: &str = "ocr";
const ACTION_SCREENSHOT: &str = "screenshot";
const ACTION_SCREENSHOT_OCR: &str = "screenshot-ocr";
const ACTION_TRANSLATION: &str = "translation";
const ACTION_CLIPBOARD: &str = "clipboard";
const ACTION_SETTINGS: &str = "settings";

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let bindings = ShortcutBindings::default();
    let menu = build_menu(app, &bindings)?;

    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .tooltip("墨识")
        .icon(menu_bar_icon())
        .icon_as_template(true);

    builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-quit" => {
                crate::native_capture::shutdown_capture_service();
                app.exit(0);
            }
            id => dispatch_action(app, id),
        })
        .build(app)?;

    Ok(())
}

/// 重建托盘菜单，用于快捷键变更后刷新菜单项右侧的加速器显示。
pub fn rebuild_menu(app: &AppHandle, bindings: &ShortcutBindings) -> Result<(), String> {
    let menu = build_menu(app, bindings).map_err(|error| error.to_string())?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_menu(Some(menu))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn build_menu(app: &AppHandle, bindings: &ShortcutBindings) -> tauri::Result<Menu<tauri::Wry>> {
    let open_ocr = MenuItem::with_id(app, ACTION_OCR, "OCR", true, accelerator_opt(&bindings.ocr))?;
    let open_screenshot = MenuItem::with_id(
        app,
        ACTION_SCREENSHOT,
        "截屏",
        true,
        accelerator_opt(&bindings.screenshot),
    )?;
    let open_screenshot_ocr = MenuItem::with_id(
        app,
        ACTION_SCREENSHOT_OCR,
        "截图 OCR",
        true,
        accelerator_opt(&bindings.screenshot_ocr),
    )?;
    let open_translation = MenuItem::with_id(
        app,
        ACTION_TRANSLATION,
        "翻译",
        true,
        accelerator_opt(&bindings.translation),
    )?;
    let open_clipboard = MenuItem::with_id(
        app,
        ACTION_CLIPBOARD,
        "剪贴板",
        true,
        accelerator_opt(&bindings.clipboard),
    )?;
    let open_settings = MenuItem::with_id(
        app,
        ACTION_SETTINGS,
        "设置",
        true,
        accelerator_opt(&bindings.settings),
    )?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出墨识", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;

    Menu::with_items(
        app,
        &[
            &open_ocr,
            &open_screenshot,
            &open_screenshot_ocr,
            &open_translation,
            &open_clipboard,
            &open_settings,
            &separator,
            &quit,
        ],
    )
}

/// 空字符串或解析失败的加速器返回 None，菜单项不显示快捷键提示。
fn accelerator_opt(accelerator: &str) -> Option<&str> {
    if accelerator.trim().is_empty() {
        None
    } else {
        Some(accelerator)
    }
}

/// 菜单点击和全局快捷键共用的分发入口。
/// `id` 取功能 ID：`ocr`、`screenshot`、`screenshot-ocr`、`translation`、`clipboard`、`settings`。
pub fn dispatch_action(app: &AppHandle, id: &str) {
    match id {
        ACTION_OCR => open_view(app, "ocr"),
        ACTION_SCREENSHOT => start_native_capture(app, Some("save")),
        ACTION_SCREENSHOT_OCR => start_native_capture(app, Some("ocr")),
        ACTION_TRANSLATION => open_translation_window(app),
        ACTION_CLIPBOARD => open_view(app, "clipboard"),
        ACTION_SETTINGS => open_view(app, "settings"),
        _ => {}
    }
}

fn menu_bar_icon() -> Image<'static> {
    const SIZE: u32 = 18;
    let mut rgba = vec![0; (SIZE * SIZE * 4) as usize];
    let mut set_pixel = |x: i32, y: i32, alpha: u8| {
        if x < 0 || y < 0 || x >= SIZE as i32 || y >= SIZE as i32 {
            return;
        }
        let index = ((y as u32 * SIZE + x as u32) * 4) as usize;
        rgba[index] = 0;
        rgba[index + 1] = 0;
        rgba[index + 2] = 0;
        rgba[index + 3] = alpha;
    };

    for x in 2..=15 {
        set_pixel(x, 1, 255);
        set_pixel(x, 16, 255);
    }
    for y in 2..=15 {
        set_pixel(1, y, 255);
        set_pixel(16, y, 255);
    }

    for y in 5..=13 {
        set_pixel(5, y, 255);
        set_pixel(12, y, 255);
    }
    for point in [(6, 6), (7, 7), (8, 8), (9, 8), (10, 7), (11, 6)] {
        set_pixel(point.0, point.1, 255);
    }
    for x in 6..=11 {
        set_pixel(x, 13, 210);
    }

    Image::new_owned(rgba, SIZE, SIZE)
}

fn start_native_capture(app: &AppHandle, default_action: Option<&str>) {
    let app = app.clone();
    let default_action = default_action.map(str::to_string);
    tauri::async_runtime::spawn_blocking(move || {
        let result = crate::native_capture::start_native_capture(
            app.clone(),
            crate::native_capture::NativeCaptureRequest {
                output_dir: None,
                default_action,
                ocr_engine: None,
                dpi: None,
                lang: None,
                force_ocr: None,
                ocr_output_dir: None,
            },
        );
        if let Err(error) = result {
            show_capture_error(&app, error);
        }
    });
}

fn show_capture_error(app: &AppHandle, message: String) {
    app.dialog()
        .message(message)
        .title("截图失败")
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::Ok)
        .show(|_| {});
}

fn open_translation_window(app: &AppHandle) {
    if let Err(error) = crate::translation_window::open_translation_window(app) {
        app.dialog()
            .message(error)
            .title("翻译失败")
            .kind(MessageDialogKind::Error)
            .buttons(MessageDialogButtons::Ok)
            .show(|_| {});
    }
}

fn open_view(app: &AppHandle, view: &str) {
    show_main_window(app);
    let _ = app.emit(EVENT_OPEN_VIEW, view);
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
