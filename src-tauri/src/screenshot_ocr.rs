use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

use crate::{backend, commands::OcrRequest, screenshot::file_name};

#[derive(Debug, Deserialize)]
pub struct ScreenshotOcrRequest {
    pub image_path: Option<String>,
    pub output_dir: Option<String>,
    pub ocr_engine: Option<String>,
    pub dpi: Option<u16>,
    pub lang: Option<String>,
    pub force_ocr: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct ScreenshotOcrResponse {
    pub image_path: String,
    pub file_name: String,
    pub recognized_text: String,
    pub items: Value,
    pub language: String,
    pub engine: String,
    pub source: String,
    pub json_path: Option<String>,
    pub txt_path: Option<String>,
    pub payload: Value,
}

pub fn run_screenshot_ocr(
    app: tauri::AppHandle,
    request: ScreenshotOcrRequest,
) -> Result<ScreenshotOcrResponse, String> {
    let image_path = match request
        .image_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(path) => PathBuf::from(path),
        None => return Err("截图 OCR 需要传入已生成的截图路径。".to_string()),
    };

    if !image_path.exists() {
        return Err(format!("截图文件不存在: {}", image_path.display()));
    }

    let language = request.lang.clone().unwrap_or_else(|| "ch".to_string());
    let engine = request
        .ocr_engine
        .clone()
        .unwrap_or_else(|| "apple-vision".to_string());
    let response = backend::run_ocr(
        app,
        OcrRequest {
            input_path: image_path.display().to_string(),
            output_dir: request.output_dir,
            output_format: Some("both".to_string()),
            ocr_engine: Some(engine.clone()),
            dpi: request.dpi,
            lang: Some(language.clone()),
            force_ocr: request.force_ocr,
        },
    )?;

    let recognized_text = response
        .payload
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let items = response
        .payload
        .get("items")
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));

    Ok(ScreenshotOcrResponse {
        file_name: file_name(&image_path),
        image_path: image_path.display().to_string(),
        recognized_text,
        items,
        language,
        engine,
        source: if request.image_path.is_some() {
            "screenshot".to_string()
        } else {
            "screenshotOcr".to_string()
        },
        json_path: response.json_path,
        txt_path: response.txt_path,
        payload: response.payload,
    })
}
