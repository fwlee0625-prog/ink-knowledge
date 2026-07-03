from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class OCRItem:
    page: int
    text: str
    source: str
    score: float | None = None
    box: list[float] | None = None
    polygon: list[list[float]] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class OCRDocument:
    input_path: Path
    items: list[OCRItem]

    @property
    def text(self) -> str:
        pages: dict[int, list[str]] = {}
        for item in self.items:
            if item.text:
                pages.setdefault(item.page, []).append(item.text)

        chunks: list[str] = []
        for page in sorted(pages):
            if len(pages) > 1:
                chunks.append(f"--- page {page} ---")
            chunks.extend(pages[page])
        return "\n".join(chunks).strip()

    def to_dict(self) -> dict[str, Any]:
        return {
            "input": str(self.input_path),
            "items": [item.to_dict() for item in self.items],
            "text": self.text,
        }
