use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use crate::screenshot::{interactive_capture_to_path, screenshot_output_dir, timestamp_millis};

#[derive(Debug, Serialize)]
pub struct ColorSampleResponse {
    pub image_path: String,
    pub hex: String,
    pub rgb: String,
    pub hsl: String,
    pub red: u8,
    pub green: u8,
    pub blue: u8,
}

pub fn sample_screen_color(app: tauri::AppHandle) -> Result<ColorSampleResponse, String> {
    let output_dir = screenshot_output_dir(&app, None)?;
    let png_path = output_dir.join(format!("color-sample-{}.png", timestamp_millis()));
    interactive_capture_to_path(&png_path)?;

    let bmp_path = png_path.with_extension("bmp");
    convert_to_bmp(&png_path, &bmp_path)?;
    let (red, green, blue) = read_center_bmp_pixel(&bmp_path)?;
    let _ = fs::remove_file(&bmp_path);

    let hex = format!("#{red:02X}{green:02X}{blue:02X}");
    let rgb = format!("rgb({red}, {green}, {blue})");
    let hsl = rgb_to_hsl(red, green, blue);

    Ok(ColorSampleResponse {
        image_path: png_path.display().to_string(),
        hex,
        rgb,
        hsl,
        red,
        green,
        blue,
    })
}

fn convert_to_bmp(source: &Path, target: &Path) -> Result<(), String> {
    let output = Command::new("sips")
        .arg("-s")
        .arg("format")
        .arg("bmp")
        .arg(source)
        .arg("--out")
        .arg(target)
        .output()
        .map_err(|error| format!("转换取色图片失败: {error}"))?;

    if output.status.success() && target.exists() {
        Ok(())
    } else {
        Err(format!(
            "转换取色图片失败: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

fn read_center_bmp_pixel(path: &PathBuf) -> Result<(u8, u8, u8), String> {
    let bytes = fs::read(path).map_err(|error| format!("读取取色图片失败: {error}"))?;
    if bytes.len() < 54 || &bytes[0..2] != b"BM" {
        return Err("无法解析取色图片。".to_string());
    }

    let offset = read_u32(&bytes, 10)? as usize;
    let width = read_i32(&bytes, 18)?;
    let height = read_i32(&bytes, 22)?;
    let bpp = read_u16(&bytes, 28)?;
    if width <= 0 || height == 0 || !matches!(bpp, 24 | 32) {
        return Err("取色图片格式不支持。".to_string());
    }

    let width = width as usize;
    let abs_height = height.unsigned_abs() as usize;
    let bytes_per_pixel = (bpp / 8) as usize;
    let row_stride = (width * bytes_per_pixel + 3) & !3;
    let x = width / 2;
    let y = abs_height / 2;
    let data_y = if height > 0 { abs_height - 1 - y } else { y };
    let index = offset + data_y * row_stride + x * bytes_per_pixel;
    if index + 2 >= bytes.len() {
        return Err("取色像素越界。".to_string());
    }

    let blue = bytes[index];
    let green = bytes[index + 1];
    let red = bytes[index + 2];
    Ok((red, green, blue))
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, String> {
    let slice = bytes
        .get(offset..offset + 2)
        .ok_or_else(|| "图片头信息不完整。".to_string())?;
    Ok(u16::from_le_bytes([slice[0], slice[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, String> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "图片头信息不完整。".to_string())?;
    Ok(u32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn read_i32(bytes: &[u8], offset: usize) -> Result<i32, String> {
    let slice = bytes
        .get(offset..offset + 4)
        .ok_or_else(|| "图片头信息不完整。".to_string())?;
    Ok(i32::from_le_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

fn rgb_to_hsl(red: u8, green: u8, blue: u8) -> String {
    let r = f64::from(red) / 255.0;
    let g = f64::from(green) / 255.0;
    let b = f64::from(blue) / 255.0;
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let lightness = (max + min) / 2.0;

    if (max - min).abs() < f64::EPSILON {
        return format!("hsl(0, 0%, {:.0}%)", lightness * 100.0);
    }

    let delta = max - min;
    let saturation = if lightness > 0.5 {
        delta / (2.0 - max - min)
    } else {
        delta / (max + min)
    };
    let mut hue = if (max - r).abs() < f64::EPSILON {
        (g - b) / delta + if g < b { 6.0 } else { 0.0 }
    } else if (max - g).abs() < f64::EPSILON {
        (b - r) / delta + 2.0
    } else {
        (r - g) / delta + 4.0
    };
    hue *= 60.0;

    format!(
        "hsl({:.0}, {:.0}%, {:.0}%)",
        hue,
        saturation * 100.0,
        lightness * 100.0
    )
}
