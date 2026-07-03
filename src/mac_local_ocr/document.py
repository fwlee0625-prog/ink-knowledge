from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory

from .backends import OCRBackend
from .models import OCRDocument, OCRItem

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


def recognize_path(
    input_path: Path,
    *,
    backend: OCRBackend,
    dpi: int = 300,
    force_ocr: bool = False,
    min_text_chars: int = 8,
) -> OCRDocument:
    input_path = input_path.expanduser().resolve()
    suffix = input_path.suffix.lower()

    if suffix == ".pdf":
        items = recognize_pdf(
            input_path,
            backend=backend,
            dpi=dpi,
            force_ocr=force_ocr,
            min_text_chars=min_text_chars,
        )
    elif suffix in IMAGE_SUFFIXES:
        items = backend.recognize_image(input_path, page=1)
    else:
        raise ValueError(f"Unsupported input type: {input_path.suffix}")

    return OCRDocument(input_path=input_path, items=items)


def recognize_pdf(
    pdf_path: Path,
    *,
    backend: OCRBackend,
    dpi: int,
    force_ocr: bool,
    min_text_chars: int,
) -> list[OCRItem]:
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("PyMuPDF is not installed. Install it with: uv pip install pymupdf") from exc

    items: list[OCRItem] = []
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)

    with TemporaryDirectory(prefix="mac-local-ocr-") as tmp_dir:
        doc = fitz.open(pdf_path)
        try:
            for page_index, page in enumerate(doc, start=1):
                text = page.get_text("text").strip()
                if text and not force_ocr and len(text) >= min_text_chars:
                    items.append(
                        OCRItem(
                            page=page_index,
                            text=text,
                            score=None,
                            box=None,
                            polygon=None,
                            source="pdf_text_layer",
                        )
                    )
                    continue

                image_path = Path(tmp_dir) / f"page_{page_index:04d}.png"
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                pix.save(str(image_path))
                items.extend(backend.recognize_image(image_path, page=page_index))
        finally:
            doc.close()

    return items
