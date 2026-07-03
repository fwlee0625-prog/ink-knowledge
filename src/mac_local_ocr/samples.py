from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate simple OCR sample images.")
    parser.add_argument("-o", "--output-dir", type=Path, default=Path("examples/ocr"), help="Output directory.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    font = load_font(34)
    small_font = load_font(26)

    samples = [
        ("sample_cn_en.png", ["本地 OCR 测试", "Hello PaddleOCR 2026", "订单号: A-1024"]),
        ("sample_numbers.png", ["发票金额: 128.50 元", "Date: 2026-07-01", "Phone: 13800138000"]),
        ("sample_mixed.png", ["姓名: 张三", "Address: Shanghai Road 88", "备注: 中英文混排 OK"]),
    ]

    for name, lines in samples:
        image = Image.new("RGB", (900, 320), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((20, 20, 880, 300), outline=(220, 220, 220), width=2)
        y = 54
        for index, line in enumerate(lines):
            draw.text((64, y), line, fill=(20, 20, 20), font=font if index == 0 else small_font)
            y += 76
        image.save(args.output_dir / name)

    print(f"Generated {len(samples)} sample images in {args.output_dir}")
    return 0


def load_font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
    ]
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


if __name__ == "__main__":
    raise SystemExit(main())
