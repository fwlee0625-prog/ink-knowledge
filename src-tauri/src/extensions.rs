use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use crate::paths::app_data_dir;

#[derive(Debug, Deserialize)]
pub struct InstallExtensionRequest {
    pub source_dir: String,
}

#[derive(Debug, Deserialize)]
pub struct UninstallExtensionRequest {
    pub id: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionCapabilities {
    pub images: Option<bool>,
    pub pdf: Option<bool>,
    pub languages: Option<Vec<String>>,
    pub text_layer: Option<bool>,
    pub requires_model_cache: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub entry: String,
    pub protocol_version: u16,
    pub capabilities: Option<ExtensionCapabilities>,
    pub model_dir: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ExtensionInfo {
    pub id: String,
    pub name: String,
    pub version: Option<String>,
    pub installed: bool,
    pub install_dir: Option<String>,
    pub entry: Option<String>,
    pub message: String,
}

pub fn list_extensions(app: tauri::AppHandle) -> Result<Vec<ExtensionInfo>, String> {
    let app_data = app_data_dir(&app)?;
    let engines_dir = app_data.join("engines");
    let mut extensions = Vec::new();
    let mut has_paddle = false;

    if let Ok(entries) = fs::read_dir(&engines_dir) {
        for entry in entries.filter_map(Result::ok) {
            if !entry
                .file_type()
                .map(|file_type| file_type.is_dir())
                .unwrap_or(false)
            {
                continue;
            }
            let engine_dir = entry.path();
            let engine_id = entry.file_name().to_string_lossy().to_string();
            if engine_id == "paddle" {
                has_paddle = true;
            }
            extensions.extend(read_engine_versions(&engine_dir)?);
        }
    }

    if !has_paddle {
        extensions.push(ExtensionInfo {
            id: "paddle".to_string(),
            name: "PaddleOCR".to_string(),
            version: None,
            installed: false,
            install_dir: None,
            entry: None,
            message: "未安装。可导入符合规范的 PaddleOCR 扩展目录。".to_string(),
        });
    }

    extensions.sort_by(|left, right| {
        left.id
            .cmp(&right.id)
            .then(left.version.cmp(&right.version))
    });
    Ok(extensions)
}

pub fn install_extension_from_dir(
    app: tauri::AppHandle,
    request: InstallExtensionRequest,
) -> Result<ExtensionInfo, String> {
    let source_dir = PathBuf::from(request.source_dir.trim());
    if !source_dir.exists() {
        return Err(format!("扩展目录不存在: {}", source_dir.display()));
    }
    if !source_dir.is_dir() {
        return Err(format!("不是扩展目录: {}", source_dir.display()));
    }

    let manifest = read_manifest(&source_dir)?;
    validate_manifest(&source_dir, &manifest)?;

    let app_data = app_data_dir(&app)?;
    let install_dir = app_data
        .join("engines")
        .join(&manifest.id)
        .join(&manifest.version);

    if install_dir.exists() {
        fs::remove_dir_all(&install_dir)
            .map_err(|error| format!("清理旧扩展失败 {}: {error}", install_dir.display()))?;
    }
    if let Some(parent) = install_dir.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建扩展目录失败: {error}"))?;
    }

    copy_dir_recursive(&source_dir, &install_dir)?;
    let entry = install_dir.join(&manifest.entry);
    make_entry_executable(&entry)?;
    check_extension_health(&entry)?;

    Ok(to_extension_info(&install_dir, &manifest))
}

pub fn uninstall_extension(
    app: tauri::AppHandle,
    request: UninstallExtensionRequest,
) -> Result<Vec<ExtensionInfo>, String> {
    let id = request.id.trim();
    if id.is_empty() {
        return Err("扩展 id 不能为空".to_string());
    }
    if id == "apple-vision" {
        return Err("内置 Apple Vision 后端不能卸载".to_string());
    }

    let app_data = app_data_dir(&app)?;
    let engine_dir = app_data.join("engines").join(id);
    if engine_dir.exists() {
        fs::remove_dir_all(&engine_dir)
            .map_err(|error| format!("卸载扩展失败 {}: {error}", engine_dir.display()))?;
    }

    list_extensions(app)
}

pub fn resolve_extension_entry(app_data: &Path, id: &str) -> Result<PathBuf, String> {
    let engine_dir = app_data.join("engines").join(id);
    let mut versions = installed_version_dirs(&engine_dir);
    versions.sort();
    versions.reverse();

    for version_dir in versions {
        let manifest_path = version_dir.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }
        let manifest = read_manifest(&version_dir)?;
        validate_manifest(&version_dir, &manifest)?;
        return Ok(version_dir.join(manifest.entry));
    }

    Err(format!("扩展未安装或 manifest 无效: {id}"))
}

fn read_engine_versions(engine_dir: &Path) -> Result<Vec<ExtensionInfo>, String> {
    let mut infos = Vec::new();

    for version_dir in installed_version_dirs(engine_dir) {
        let manifest_path = version_dir.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }
        let manifest = read_manifest(&version_dir)?;
        infos.push(to_extension_info(&version_dir, &manifest));
    }
    Ok(infos)
}

fn installed_version_dirs(engine_dir: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(engine_dir) else {
        return Vec::new();
    };

    entries
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .map(|file_type| file_type.is_dir())
                .unwrap_or(false)
        })
        .map(|entry| entry.path())
        .collect()
}

fn read_manifest(extension_dir: &Path) -> Result<ExtensionManifest, String> {
    let manifest_path = extension_dir.join("manifest.json");
    let content = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "读取扩展 manifest 失败 {}: {error}",
            manifest_path.display()
        )
    })?;
    serde_json::from_str(&content).map_err(|error| format!("解析扩展 manifest 失败: {error}"))
}

fn validate_manifest(extension_dir: &Path, manifest: &ExtensionManifest) -> Result<(), String> {
    if manifest.id.trim().is_empty() {
        return Err("扩展 manifest.id 不能为空".to_string());
    }
    if manifest.version.trim().is_empty() {
        return Err("扩展 manifest.version 不能为空".to_string());
    }
    if manifest.protocol_version != 1 {
        return Err(format!(
            "不支持的扩展协议版本: {}",
            manifest.protocol_version
        ));
    }
    if manifest.platform != "macos" {
        return Err(format!("扩展平台不匹配: {}", manifest.platform));
    }
    if manifest.arch != current_arch() {
        return Err(format!(
            "扩展架构不匹配: {}，当前架构: {}",
            manifest.arch,
            current_arch()
        ));
    }

    let entry = extension_dir.join(&manifest.entry);
    if !entry.exists() {
        return Err(format!("扩展入口不存在: {}", entry.display()));
    }
    if !entry.is_file() {
        return Err(format!("扩展入口不是文件: {}", entry.display()));
    }
    Ok(())
}

fn check_extension_health(entry: &Path) -> Result<(), String> {
    let output = Command::new(entry)
        .arg("--help")
        .output()
        .map_err(|error| format!("扩展健康检查启动失败 {}: {error}", entry.display()))?;
    if output.status.success() {
        return Ok(());
    }

    Err(format!(
        "扩展健康检查失败: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    ))
}

fn current_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        value => value,
    }
}

fn to_extension_info(install_dir: &Path, manifest: &ExtensionManifest) -> ExtensionInfo {
    ExtensionInfo {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        version: Some(manifest.version.clone()),
        installed: true,
        install_dir: Some(install_dir.display().to_string()),
        entry: Some(install_dir.join(&manifest.entry).display().to_string()),
        message: "已安装".to_string(),
    }
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("创建目录失败 {}: {error}", target.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("读取目录失败 {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("读取目录条目失败: {error}"))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("读取文件类型失败 {}: {error}", source_path.display()))?;

        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
        } else if file_type.is_file() {
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "复制扩展文件失败 {} -> {}: {error}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

#[cfg(unix)]
fn make_entry_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = fs::metadata(path)
        .map_err(|error| format!("读取扩展入口权限失败 {}: {error}", path.display()))?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions)
        .map_err(|error| format!("设置扩展入口可执行权限失败 {}: {error}", path.display()))
}

#[cfg(not(unix))]
fn make_entry_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}
