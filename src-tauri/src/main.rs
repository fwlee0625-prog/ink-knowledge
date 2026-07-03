mod backend;
mod commands;
mod extensions;
mod paths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::check_backend,
            commands::install_extension_from_dir,
            commands::get_default_settings,
            commands::list_extensions,
            commands::open_result_file,
            commands::preview_result_file,
            commands::reveal_result_file,
            commands::scan_supported_files,
            commands::uninstall_extension,
            commands::run_ocr
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
