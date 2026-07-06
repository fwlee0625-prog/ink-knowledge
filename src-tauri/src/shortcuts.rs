use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState, ShortcutWrapper};

/// 可配置的全局快捷键绑定。字段名对应功能 ID，值为 Tauri Accelerator 字符串。
/// 空字符串表示该功能不注册快捷键。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutBindings {
    #[serde(rename = "ocr")]
    pub ocr: String,
    #[serde(rename = "screenshot")]
    pub screenshot: String,
    #[serde(rename = "screenshotOcr")]
    pub screenshot_ocr: String,
    #[serde(rename = "translation")]
    pub translation: String,
    #[serde(rename = "clipboard")]
    pub clipboard: String,
    #[serde(rename = "settings")]
    pub settings: String,
}

impl Default for ShortcutBindings {
    fn default() -> Self {
        Self {
            ocr: "Alt+Shift+O".to_string(),
            screenshot: "Alt+Shift+S".to_string(),
            screenshot_ocr: "Alt+Shift+X".to_string(),
            translation: "Alt+Shift+T".to_string(),
            clipboard: "Alt+Shift+V".to_string(),
            settings: "Alt+Shift+Comma".to_string(),
        }
    }
}

impl ShortcutBindings {
    /// 返回 (功能 ID, 加速器) 列表，跳过空字符串。
    fn entries(&self) -> Vec<(&'static str, &str)> {
        vec![
            ("ocr", self.ocr.as_str()),
            ("screenshot", self.screenshot.as_str()),
            ("screenshot-ocr", self.screenshot_ocr.as_str()),
            ("translation", self.translation.as_str()),
            ("clipboard", self.clipboard.as_str()),
            ("settings", self.settings.as_str()),
        ]
    }

    /// 校验所有加速器是否合法，返回第一个解析失败的错误描述。
    pub fn validate(&self) -> Result<(), String> {
        for (id, accelerator) in self.entries() {
            if accelerator.trim().is_empty() {
                continue;
            }
            validate_accelerator(accelerator, id)?;
        }
        Ok(())
    }
}

pub fn default_bindings() -> ShortcutBindings {
    ShortcutBindings::default()
}

fn validate_accelerator(accelerator: &str, id: &str) -> Result<(), String> {
    ShortcutWrapper::try_from(accelerator)
        .map(|_| ())
        .map_err(|error| format!("快捷键 {id} ({accelerator}) 无效: {error}"))
}

/// 注册全局快捷键。先注销已有快捷键，再按 bindings 重新注册。
/// 同时会重建托盘菜单，让菜单项右侧显示最新的快捷键提示。
pub fn register_all(app: &AppHandle, bindings: &ShortcutBindings) -> Result<(), String> {
    bindings.validate()?;

    let manager = app.global_shortcut();
    // 注销已有快捷键；忽略未注册项的错误。
    let _ = manager.unregister_all();

    for (id, accelerator) in bindings.entries() {
        if accelerator.trim().is_empty() {
            continue;
        }
        let id_owned = id.to_string();
        manager
            .on_shortcut(accelerator, move |handle, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    crate::tray::dispatch_action(handle, &id_owned);
                }
            })
            .map_err(|error| format!("注册快捷键 {id} ({accelerator}) 失败: {error}"))?;
    }

    // 重建托盘菜单，让菜单项加速器显示与最新绑定保持一致。
    crate::tray::rebuild_menu(app, bindings)?;

    Ok(())
}
