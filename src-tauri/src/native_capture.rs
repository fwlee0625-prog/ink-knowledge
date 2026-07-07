use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    env, fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver},
        Mutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use crate::{
    clipboard::{write_clipboard_text, ClipboardWriteRequest},
    ocr_result_window::OcrResultWindowRequest,
    screenshot::{file_name, screenshot_output_dir},
    screenshot_ocr::{ScreenshotOcrRequest, ScreenshotOcrResponse},
};
use tauri::{Emitter, Manager};

const CAPTURE_HELPER_BIN: &str = "moshi-capture-helper";
const EVENT_NATIVE_CAPTURE_FINISHED: &str = "native-capture-finished";
static CAPTURE_SERVICE: OnceLock<Mutex<Option<CaptureServiceClient>>> = OnceLock::new();
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Deserialize)]
pub struct NativeCaptureRequest {
    #[serde(alias = "outputDir")]
    pub output_dir: Option<String>,
    #[serde(alias = "defaultAction")]
    pub default_action: Option<String>,
    #[serde(alias = "ocrEngine")]
    pub ocr_engine: Option<String>,
    pub dpi: Option<u16>,
    pub lang: Option<String>,
    #[serde(alias = "forceOcr")]
    pub force_ocr: Option<bool>,
    #[serde(alias = "ocrOutputDir")]
    pub ocr_output_dir: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCaptureResponse {
    pub action: String,
    pub image_path: Option<String>,
    pub file_name: Option<String>,
    pub rect: Option<CaptureRect>,
    pub message: String,
    pub ocr: Option<ScreenshotOcrResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HelperCaptureResponse {
    #[serde(alias = "requestId")]
    request_id: Option<String>,
    action: String,
    image_path: Option<String>,
    file_name: Option<String>,
    rect: Option<CaptureRect>,
    message: Option<String>,
}

struct CaptureServiceClient {
    helper: PathBuf,
    child: Child,
    stdin: ChildStdin,
    stdout_rx: Receiver<String>,
}

pub fn start_native_capture(
    app: tauri::AppHandle,
    request: NativeCaptureRequest,
) -> Result<NativeCaptureResponse, String> {
    let output_dir = screenshot_output_dir(&app, request.output_dir.as_deref())?;
    let helper = resolve_capture_helper(&app).ok_or_else(|| {
        "未找到原生截图 helper，请先运行 pnpm run build:macos-capture。".to_string()
    })?;

    let default_action = request
        .default_action
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(action) = default_action {
        if !matches!(action, "save" | "copy" | "ocr") {
            return Err(format!("不支持的原生截图默认动作: {action}"));
        }
    }

    let helper_response = match run_capture_with_service(&helper, &output_dir, default_action) {
        Ok(response) => response,
        Err(error) => {
            eprintln!("moshi-capture-helper service failed, fallback to one-shot: {error}");
            run_capture_one_shot(&helper, &output_dir, default_action)?
        }
    };

    if helper_response.action == "error" {
        return Err(helper_response
            .message
            .unwrap_or_else(|| "原生截图启动失败。".to_string()));
    }

    if helper_response.action == "cancel" {
        return Ok(NativeCaptureResponse {
            action: helper_response.action,
            image_path: None,
            file_name: None,
            rect: helper_response.rect,
            message: "已取消截图。".to_string(),
            ocr: None,
        });
    }

    let image_path = helper_response
        .image_path
        .clone()
        .ok_or_else(|| "原生截图没有返回图片路径。".to_string())?;
    ensure_image_file(Path::new(&image_path))?;

    let ocr = if helper_response.action == "ocr" {
        let response = crate::screenshot_ocr::run_screenshot_ocr(
            app.clone(),
            ScreenshotOcrRequest {
                image_path: Some(image_path.clone()),
                output_dir: request.ocr_output_dir,
                ocr_engine: request.ocr_engine,
                dpi: request.dpi,
                lang: request.lang,
                force_ocr: request.force_ocr,
            },
        )?;
        if !response.recognized_text.trim().is_empty() {
            let _ = write_clipboard_text(ClipboardWriteRequest {
                text: response.recognized_text.clone(),
                source: Some("ocr".to_string()),
            });
        }
        let _ = crate::ocr_result_window::open_ocr_result_window(
            &app,
            OcrResultWindowRequest {
                image_path: response.image_path.clone(),
                recognized_text: response.recognized_text.clone(),
                items: Some(response.items.clone()),
                language: Some(response.language.clone()),
                engine: Some(response.engine.clone()),
                source: Some(response.source.clone()),
            },
        );
        Some(response)
    } else {
        None
    };

    let response = NativeCaptureResponse {
        action: helper_response.action.clone(),
        image_path: Some(image_path.clone()),
        file_name: Some(
            helper_response
                .file_name
                .unwrap_or_else(|| file_name(Path::new(&image_path))),
        ),
        rect: helper_response.rect,
        message: message_for_action(&helper_response.action),
        ocr,
    };

    let _ = app.emit(EVENT_NATIVE_CAPTURE_FINISHED, &response);
    Ok(response)
}

pub fn prewarm_capture_service(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(helper) = resolve_capture_helper(&app) else {
            return;
        };
        let lock = CAPTURE_SERVICE.get_or_init(|| Mutex::new(None));
        let Ok(mut slot) = lock.lock() else {
            return;
        };
        if ensure_capture_service(&mut slot, &helper).is_err() {
            *slot = None;
        }
    });
}

pub fn shutdown_capture_service() {
    let Some(lock) = CAPTURE_SERVICE.get() else {
        return;
    };
    let Ok(mut slot) = lock.lock() else {
        return;
    };
    if let Some(mut client) = slot.take() {
        client.shutdown();
    }
}

fn run_capture_with_service(
    helper: &Path,
    output_dir: &Path,
    default_action: Option<&str>,
) -> Result<HelperCaptureResponse, String> {
    let lock = CAPTURE_SERVICE.get_or_init(|| Mutex::new(None));
    let mut slot = lock
        .lock()
        .map_err(|_| "截图服务状态锁已损坏。".to_string())?;
    let client = ensure_capture_service(&mut slot, helper)?;
    client.capture(output_dir, default_action)
}

fn ensure_capture_service<'a>(
    slot: &'a mut Option<CaptureServiceClient>,
    helper: &Path,
) -> Result<&'a mut CaptureServiceClient, String> {
    let should_restart = match slot.as_mut() {
        Some(client) if client.helper != helper => true,
        Some(client) => client
            .child
            .try_wait()
            .map_err(|error| format!("检查截图服务状态失败: {error}"))?
            .is_some(),
        None => true,
    };

    if should_restart {
        *slot = Some(CaptureServiceClient::spawn(helper)?);
    }

    slot.as_mut()
        .ok_or_else(|| "截图服务没有成功启动。".to_string())
}

fn run_capture_one_shot(
    helper: &Path,
    output_dir: &Path,
    default_action: Option<&str>,
) -> Result<HelperCaptureResponse, String> {
    let mut command = Command::new(helper);
    command.arg("--output-dir").arg(output_dir);
    if let Some(action) = default_action {
        command.arg("--default-action").arg(action);
    }

    let output = command
        .output()
        .map_err(|error| format!("启动原生截图 helper 失败: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !output.status.success() {
        if let Ok(response) = serde_json::from_str::<HelperCaptureResponse>(&stdout) {
            if let Some(message) = response.message {
                return Err(message);
            }
        }
        return Err(if stderr.is_empty() {
            "原生截图已取消或启动失败。".to_string()
        } else {
            stderr
        });
    }

    serde_json::from_str(&stdout).map_err(|error| {
        format!("解析原生截图结果失败: {error}; stdout: {stdout}; stderr: {stderr}")
    })
}

impl CaptureServiceClient {
    fn spawn(helper: &Path) -> Result<CaptureServiceClient, String> {
        let mut child = Command::new(helper)
            .arg("--service")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("启动常驻截图服务失败: {error}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "无法连接常驻截图服务 stdin。".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "无法连接常驻截图服务 stdout。".to_string())?;

        if let Some(stderr) = child.stderr.take() {
            thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("moshi-capture-helper: {line}");
                }
            });
        }

        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });

        Ok(CaptureServiceClient {
            helper: helper.to_path_buf(),
            child,
            stdin,
            stdout_rx: rx,
        })
    }

    fn capture(
        &mut self,
        output_dir: &Path,
        default_action: Option<&str>,
    ) -> Result<HelperCaptureResponse, String> {
        let request_id = next_request_id();
        let request = json!({
            "command": "capture",
            "requestId": request_id,
            "outputDir": output_dir,
            "defaultAction": default_action,
        });
        let line = serde_json::to_string(&request)
            .map_err(|error| format!("序列化截图服务请求失败: {error}"))?;
        writeln!(self.stdin, "{line}").map_err(|error| format!("写入截图服务请求失败: {error}"))?;
        self.stdin
            .flush()
            .map_err(|error| format!("刷新截图服务请求失败: {error}"))?;

        loop {
            let line = self
                .stdout_rx
                .recv()
                .map_err(|_| "截图服务已退出。".to_string())?;
            let response: HelperCaptureResponse = serde_json::from_str(&line)
                .map_err(|error| format!("解析截图服务响应失败: {error}; stdout: {line}"))?;

            if response.action == "ready" {
                continue;
            }

            if response.request_id.as_deref() == Some(request_id.as_str()) {
                return Ok(response);
            }

            if response.request_id.is_none() && response.action == "error" {
                return Err(response
                    .message
                    .unwrap_or_else(|| "截图服务返回未知错误。".to_string()));
            }
        }
    }

    fn shutdown(&mut self) {
        let _ = writeln!(self.stdin, "{}", json!({ "command": "shutdown" }));
        let _ = self.stdin.flush();

        for _ in 0..20 {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }

        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn next_request_id() -> String {
    let counter = REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("{millis}-{counter}")
}

pub fn capture_native_region(
    app: tauri::AppHandle,
    output_dir: Option<String>,
) -> Result<crate::screenshot::ScreenshotResponse, String> {
    let response = start_native_capture(
        app,
        NativeCaptureRequest {
            output_dir,
            default_action: Some("save".to_string()),
            ocr_engine: None,
            dpi: None,
            lang: None,
            force_ocr: None,
            ocr_output_dir: None,
        },
    )?;

    let image_path = response
        .image_path
        .ok_or_else(|| "已取消截图或没有生成截图。".to_string())?;
    Ok(crate::screenshot::ScreenshotResponse {
        file_name: response
            .file_name
            .unwrap_or_else(|| file_name(Path::new(&image_path))),
        image_path,
        message: response.message,
    })
}

fn message_for_action(action: &str) -> String {
    match action {
        "copy" => "截图已复制到剪贴板。".to_string(),
        "ocr" => "截图 OCR 识别完成。".to_string(),
        "save" => "截图已保存。".to_string(),
        "saveAs" => "截图已另存为。".to_string(),
        _ => "截图完成。".to_string(),
    }
}

fn resolve_capture_helper(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(value) = env::var("MOSHI_CAPTURE_HELPER_BIN") {
        let path = PathBuf::from(value);
        if path.exists() {
            return Some(path);
        }
    }

    #[cfg(debug_assertions)]
    if let Ok(root) = crate::paths::backend_root() {
        let helper = root
            .join("macos-capture")
            .join("bin")
            .join(CAPTURE_HELPER_BIN);
        if helper.exists() {
            return Some(helper);
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        for relative in [
            PathBuf::from(CAPTURE_HELPER_BIN),
            Path::new("macos-capture")
                .join("bin")
                .join(CAPTURE_HELPER_BIN),
            Path::new("_up_")
                .join("macos-capture")
                .join("bin")
                .join(CAPTURE_HELPER_BIN),
        ] {
            let helper = resource_dir.join(relative);
            if helper.exists() {
                return Some(helper);
            }
        }
    }

    #[cfg(debug_assertions)]
    if let Some(path) = crate::paths::which(CAPTURE_HELPER_BIN) {
        return Some(path);
    }

    None
}

fn ensure_image_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("截图文件不存在: {}", path.display()));
    }
    if !path.is_file() {
        return Err(format!("不是截图文件: {}", path.display()));
    }
    fs::metadata(path).map_err(|error| format!("读取截图文件失败: {error}"))?;
    Ok(())
}
