from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
EXAMPLE_DIR = ROOT / "examples" / "ocr"
IMAGE_DIR = EXAMPLE_DIR / "images"


def main() -> None:
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)

    font_large = load_font(42)
    font_medium = load_font(34)

    create_image(
        IMAGE_DIR / "simple_en.png",
        [
            ("Hello OCR", font_large),
            ("Invoice No. A-2026-0701", font_medium),
            ("Total: 12345.67", font_medium),
        ],
    )
    create_image(
        IMAGE_DIR / "simple_numbers.png",
        [
            ("2026-07-01", font_large),
            ("ID: 310101199001011234", font_medium),
            ("Phone: 138-0000-1234", font_medium),
        ],
    )
    create_image(
        IMAGE_DIR / "simple_mixed.png",
        [
            ("本地 OCR 测试", font_large),
            ("Mac M2 + PaddleOCR", font_medium),
            ("金额: 88.50 元", font_medium),
        ],
    )
    create_pdf(EXAMPLE_DIR / "sample_text.pdf", font_medium)

    print(f"Generated samples in {IMAGE_DIR}")


def create_image(path: Path, lines: list[tuple[str, ImageFont.ImageFont]]) -> None:
    image = Image.new("RGB", (900, 360), "white")
    draw = ImageDraw.Draw(image)
    y = 54

    for text, font in lines:
        draw.text((64, y), text, fill=(20, 20, 20), font=font)
        y += 84

    image.save(path)


def create_pdf(path: Path, font: ImageFont.ImageFont) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image_path = IMAGE_DIR / "simple_mixed.png"

    page = Image.new("RGB", (900, 360), "white")
    draw = ImageDraw.Draw(page)
    draw.text((64, 72), "This PDF has a text-like sample image.", fill=(20, 20, 20), font=font)
    draw.text((64, 140), "PDF OCR smoke page 1", fill=(20, 20, 20), font=font)
    page.save(path, "PDF", resolution=100.0)

    if not image_path.exists():
        create_image(image_path, [("本地 OCR 测试", font)])


def load_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]

    for font_path in candidates:
        if Path(font_path).exists():
            try:
                return ImageFont.truetype(font_path, size=size)
            except OSError:
                continue

    return ImageFont.load_default()


if __name__ == "__main__":
    main()
