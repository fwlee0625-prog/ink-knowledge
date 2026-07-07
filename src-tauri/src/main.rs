mod backend;
mod clipboard;
mod clipboard_repo;
mod commands;
mod extensions;
mod native_capture;
mod native_pasteboard;
mod ocr_result_window;
mod paths;
mod screenshot;
mod screenshot_ocr;
mod settings_repo;
mod shortcuts;
mod storage;
mod translation;
mod translation_window;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::{Manager, WindowEvent};
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            app.set_dock_visibility(false);
            tray::init(app.handle())?;
            // 启动时按默认快捷键注册一次，保证前端加载前托盘菜单已有快捷键提示。
            // 前端加载后会用 SQLite 中保存的偏好覆盖默认绑定。
            let handle = app.handle().clone();
            let bindings = shortcuts::default_bindings();
            if let Err(error) = shortcuts::register_all(&handle, &bindings) {
                eprintln!("注册默认快捷键失败: {error}");
            }
            native_capture::prewarm_capture_service(app.handle().clone());

            // 初始化剪贴板历史 SQLite 仓库并启动后台轮询。
            // 前端加载设置后会通过 update_clipboard_config 命令覆盖默认 max_items。
            match native_pasteboard::PasteboardState::new(app.handle()) {
                Ok(state) => {
                    app.manage(state);
                    native_pasteboard::start_polling(app.handle().clone());
                }
                Err(error) => {
                    eprintln!("初始化剪贴板仓库失败: {error}");
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::check_backend,
            commands::capture_region,
            commands::clear_app_settings,
            commands::clear_clipboard_history,
            commands::clear_ocr_output_dir,
            commands::clear_storage_cache,
            commands::copy_screenshot,
            commands::delete_clipboard_item,
            commands::install_extension_from_dir,
            commands::get_default_settings,
            commands::get_default_shortcut_bindings,
            commands::get_pending_ocr_result,
            commands::get_storage_usage,
            commands::load_app_settings,
            commands::list_clipboard_history,
            commands::list_extensions,
            commands::open_result_file,
            commands::open_ocr_result_window,
            commands::open_translation_window,
            commands::preview_result_file,
            commands::refresh_clipboard_expired,
            commands::register_shortcuts,
            commands::reveal_result_file,
            commands::read_clipboard_text,
            commands::run_screenshot_ocr,
            commands::save_screenshot,
            commands::save_app_settings,
            commands::scan_supported_files,
            commands::set_clipboard_pinned,
            commands::set_clipboard_polling,
            commands::start_native_capture,
            commands::translate_text,
            commands::uninstall_extension,
            commands::update_clipboard_config,
            commands::use_clipboard_item,
            commands::write_clipboard_text,
            commands::run_ocr
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
