from __future__ import annotations

import argparse
import json
from pathlib import Path

from .backends import OCR_ENGINES, create_ocr_backend
from .document import recognize_path
from .models import OCRDocument


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Mac local OCR CLI prototype.")
    parser.add_argument("inputs", nargs="+", type=Path, help="Image or PDF files to recognize.")
    parser.add_argument("-o", "--output-dir", type=Path, default=Path("output"), help="Output directory.")
    parser.add_argument(
        "--format",
        choices=("txt", "json", "both"),
        default="both",
        help="Output format.",
    )
    parser.add_argument("--dpi", type=int, default=300, help="PDF render DPI for scanned pages.")
    parser.add_argument(
        "--engine",
        choices=OCR_ENGINES,
        default="apple-vision",
        help="OCR engine to use.",
    )
    parser.add_argument("--lang", default="ch", help="OCR language, default: ch.")
    parser.add_argument("--force-ocr", action="store_true", help="OCR every PDF page even if it has text.")
    parser.add_argument(
        "--min-text-chars",
        type=int,
        default=8,
        help="Minimum extracted PDF text length to skip OCR for a page.",
    )
    parser.add_argument(
        "--enable-orientation",
        action="store_true",
        help="Enable PaddleOCR textline orientation classification.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    args.output_dir.mkdir(parents=True, exist_ok=True)

    backend = create_ocr_backend(
        engine=args.engine,
        lang=args.lang,
        use_textline_orientation=args.enable_orientation,
    )

    failures = 0
    for input_path in args.inputs:
        try:
            document = recognize_path(
                input_path,
                backend=backend,
                dpi=args.dpi,
                force_ocr=args.force_ocr,
                min_text_chars=args.min_text_chars,
            )
            write_outputs(document, output_dir=args.output_dir, output_format=args.format)
            print(f"OK {input_path} -> {args.output_dir}")
        except Exception as exc:
            failures += 1
            print(f"ERROR {input_path}: {exc}")

    return 1 if failures else 0


def write_outputs(document: OCRDocument, *, output_dir: Path, output_format: str) -> None:
    stem = document.input_path.stem
    if output_format in {"txt", "both"}:
        (output_dir / f"{stem}.txt").write_text(document.text + "\n", encoding="utf-8")

    if output_format in {"json", "both"}:
        payload = document.to_dict()
        (output_dir / f"{stem}.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


if __name__ == "__main__":
    raise SystemExit(main())
