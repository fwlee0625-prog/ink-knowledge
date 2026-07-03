from pathlib import Path

from mac_local_ocr.models import OCRDocument, OCRItem


def test_document_text_groups_pages():
    document = OCRDocument(
        input_path=Path("demo.pdf"),
        items=[
            OCRItem(page=2, text="second", source="ocr"),
            OCRItem(page=1, text="first", source="pdf_text_layer"),
        ],
    )

    assert document.text == "--- page 1 ---\nfirst\n--- page 2 ---\nsecond"
