use semver::Version;
use serde::{Deserialize, Serialize};
use std::{
    process::Command,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

const EVENT_APP_UPDATE_STATUS_CHANGED: &str = "app-update-status-changed";
const RELEASE_CONFIG_JSON: &str = include_str!("../../release/config.json");
const MAX_RESPONSE_BYTES: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateStatus {
    pub state: String,
    pub current_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_page_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl AppUpdateStatus {
    fn idle(current_version: String) -> Self {
        Self {
            state: "idle".to_string(),
            current_version,
            latest_version: None,
            release_name: None,
            release_notes: None,
            published_at: None,
            download_url: None,
            release_page_url: None,
            checked_at: None,
            error: None,
        }
    }

    fn checking(current_version: String) -> Self {
        Self {
            state: "checking".to_string(),
            ..Self::idle(current_version)
        }
    }

    fn error(current_version: String, error: String) -> Self {
        Self {
            state: "error".to_string(),
            checked_at: Some(unix_millis_string()),
            error: Some(error),
            ..Self::idle(current_version)
        }
    }
}

pub struct UpdateState {
    status: Mutex<AppUpdateStatus>,
    startup_check_started: AtomicBool,
    check_in_progress: AtomicBool,
}

impl UpdateState {
    pub fn new(current_version: String) -> Self {
        Self {
            status: Mutex::new(AppUpdateStatus::idle(current_version)),
            startup_check_started: AtomicBool::new(false),
            check_in_progress: AtomicBool::new(false),
        }
    }

    pub fn status(&self) -> AppUpdateStatus {
        self.status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    fn replace(&self, status: AppUpdateStatus) {
        *self
            .status
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = status;
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseConfig {
    github_repository: String,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    published_at: Option<String>,
    html_url: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

pub fn start_startup_check(app: AppHandle) {
    let state = app.state::<UpdateState>();
    if state.startup_check_started.swap(true, Ordering::SeqCst) {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let _ = check_and_store(app).await;
    });
}

pub async fn check_and_store(app: AppHandle) -> AppUpdateStatus {
    let state = app.state::<UpdateState>();
    if state.check_in_progress.swap(true, Ordering::SeqCst) {
        return state.status();
    }
    let current_version = state.status().current_version;
    state.replace(AppUpdateStatus::checking(current_version.clone()));
    emit_status(&app, &state.status());

    let version_for_check = current_version.clone();
    let result =
        tauri::async_runtime::spawn_blocking(move || fetch_latest_release(&version_for_check))
            .await;
    let status = match result {
        Ok(Ok(release)) => release,
        Ok(Err(error)) => AppUpdateStatus::error(current_version, error),
        Err(error) => AppUpdateStatus::error(current_version, format!("检查更新任务失败: {error}")),
    };
    state.replace(status.clone());
    state.check_in_progress.store(false, Ordering::SeqCst);
    emit_status(&app, &status);
    status
}

fn fetch_latest_release(current_version: &str) -> Result<AppUpdateStatus, String> {
    let repository = github_repository()?;
    let endpoint = format!("https://api.github.com/repos/{repository}/releases/latest");
    let output = Command::new("curl")
        .arg("-sS")
        .arg("--connect-timeout")
        .arg("5")
        .arg("--max-time")
        .arg("10")
        .arg("--max-filesize")
        .arg(MAX_RESPONSE_BYTES.to_string())
        .arg("-H")
        .arg("Accept: application/vnd.github+json")
        .arg("-H")
        .arg("X-GitHub-Api-Version: 2022-11-28")
        .arg("-A")
        .arg(format!("Moshi/{current_version}"))
        .arg("-w")
        .arg("\n%{http_code}")
        .arg(endpoint)
        .output()
        .map_err(|error| format!("启动更新请求失败: {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "连接 GitHub 失败。".to_string()
        } else {
            format!("连接 GitHub 失败: {detail}")
        });
    }
    if output.stdout.len() > MAX_RESPONSE_BYTES + 4 {
        return Err("GitHub Release 响应过大。".to_string());
    }

    let separator = output
        .stdout
        .iter()
        .rposition(|byte| *byte == b'\n')
        .ok_or_else(|| "GitHub API 没有返回 HTTP 状态。".to_string())?;
    let body = &output.stdout[..separator];
    let status_code = std::str::from_utf8(&output.stdout[separator + 1..])
        .ok()
        .and_then(|value| value.trim().parse::<u16>().ok())
        .ok_or_else(|| "GitHub API 返回了无效 HTTP 状态。".to_string())?;
    if !(200..300).contains(&status_code) {
        return Err(match status_code {
            404 => "GitHub 仓库尚未发布正式 Release，或仓库配置不正确。".to_string(),
            403 | 429 => "GitHub API 请求受限，请稍后再试。".to_string(),
            _ => format!("GitHub API 返回 HTTP {status_code}。"),
        });
    }

    let release: GitHubRelease = serde_json::from_slice(body)
        .map_err(|error| format!("解析 GitHub Release 失败: {error}"))?;
    build_status(current_version, release)
}

fn build_status(current_version: &str, release: GitHubRelease) -> Result<AppUpdateStatus, String> {
    let current = Version::parse(current_version)
        .map_err(|error| format!("当前应用版本不符合 SemVer: {error}"))?;
    let latest_text = release
        .tag_name
        .strip_prefix('v')
        .ok_or_else(|| "GitHub Release 标签必须使用 vMAJOR.MINOR.PATCH 格式。".to_string())?;
    let latest = Version::parse(latest_text)
        .map_err(|error| format!("GitHub Release 标签不符合 SemVer: {error}"))?;
    if !latest.pre.is_empty() || !latest.build.is_empty() {
        return Err("正式更新标签必须使用 vMAJOR.MINOR.PATCH 格式。".to_string());
    }
    let release_page_url = validate_github_url(&release.html_url)?;
    let download_url = release
        .assets
        .iter()
        .find(|asset| asset.name.to_ascii_lowercase().ends_with(".dmg"))
        .map(|asset| validate_github_url(&asset.browser_download_url))
        .transpose()?;

    Ok(AppUpdateStatus {
        state: if latest > current {
            "update_available".to_string()
        } else {
            "up_to_date".to_string()
        },
        current_version: current.to_string(),
        latest_version: Some(latest.to_string()),
        release_name: release.name.filter(|value| !value.trim().is_empty()),
        release_notes: release.body.filter(|value| !value.trim().is_empty()),
        published_at: release.published_at,
        download_url,
        release_page_url: Some(release_page_url),
        checked_at: Some(unix_millis_string()),
        error: None,
    })
}

fn github_repository() -> Result<String, String> {
    if let Some(value) = option_env!("MOSHI_GITHUB_REPOSITORY") {
        let value = value.trim();
        if !value.is_empty() {
            validate_repository(value)?;
            return Ok(value.to_string());
        }
    }

    let config: ReleaseConfig = serde_json::from_str(RELEASE_CONFIG_JSON)
        .map_err(|error| format!("解析 release/config.json 失败: {error}"))?;
    let repository = config.github_repository.trim();
    if repository.is_empty() {
        return Err(
            "尚未配置 GitHub 仓库，请填写 release/config.json 的 githubRepository。".to_string(),
        );
    }
    validate_repository(repository)?;
    Ok(repository.to_string())
}

fn validate_repository(repository: &str) -> Result<(), String> {
    let mut parts = repository.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    let valid_part = |value: &str| {
        !value.is_empty()
            && value.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.')
            })
    };
    if !valid_part(owner) || !valid_part(name) || parts.next().is_some() {
        return Err("GitHub 仓库配置必须使用 owner/repo 格式。".to_string());
    }
    Ok(())
}

fn validate_github_url(value: &str) -> Result<String, String> {
    let url = Url::parse(value).map_err(|_| "GitHub Release 返回了无效链接。".to_string())?;
    let allowed_host = matches!(
        url.host_str(),
        Some("github.com")
            | Some("objects.githubusercontent.com")
            | Some("release-assets.githubusercontent.com")
    );
    if url.scheme() != "https" || !allowed_host {
        return Err("GitHub Release 返回了不受信任的下载链接。".to_string());
    }
    Ok(url.to_string())
}

fn emit_status(app: &AppHandle, status: &AppUpdateStatus) {
    let _ = app.emit(EVENT_APP_UPDATE_STATUS_CHANGED, status);
}

fn unix_millis_string() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, assets: Vec<GitHubAsset>) -> GitHubRelease {
        GitHubRelease {
            tag_name: tag.to_string(),
            name: Some(format!("墨识 {tag}")),
            body: Some("更新说明".to_string()),
            published_at: Some("2026-07-10T00:00:00Z".to_string()),
            html_url: "https://github.com/example/moshi/releases/tag/v0.2.0".to_string(),
            assets,
        }
    }

    #[test]
    fn marks_newer_version_as_available_and_selects_dmg() {
        let status = build_status(
            "0.1.0",
            release(
                "v0.2.0",
                vec![GitHubAsset {
                    name: "moshi.dmg".to_string(),
                    browser_download_url:
                        "https://github.com/example/moshi/releases/download/v0.2.0/moshi.dmg"
                            .to_string(),
                }],
            ),
        )
        .unwrap();
        assert_eq!(status.state, "update_available");
        assert!(status.download_url.is_some());
    }

    #[test]
    fn equal_or_older_release_is_up_to_date() {
        assert_eq!(
            build_status("0.2.0", release("v0.2.0", vec![]))
                .unwrap()
                .state,
            "up_to_date"
        );
        assert_eq!(
            build_status("0.3.0", release("v0.2.0", vec![]))
                .unwrap()
                .state,
            "up_to_date"
        );
    }

    #[test]
    fn falls_back_to_release_page_without_dmg() {
        let status = build_status("0.1.0", release("v0.2.0", vec![])).unwrap();
        assert!(status.download_url.is_none());
        assert!(status.release_page_url.is_some());
    }

    #[test]
    fn rejects_invalid_tag_and_untrusted_url() {
        assert!(build_status("0.1.0", release("0.2.0", vec![])).is_err());
        assert!(build_status("0.1.0", release("v0.2.0-beta.1", vec![])).is_err());
        let mut invalid = release("v0.2.0", vec![]);
        invalid.html_url = "https://example.com/release".to_string();
        assert!(build_status("0.1.0", invalid).is_err());
    }
}
