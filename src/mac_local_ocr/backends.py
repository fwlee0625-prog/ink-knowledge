from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Protocol

from .models import OCRItem

OCR_ENGINE_PADDLE = "paddle"
OCR_ENGINE_APPLE_VISION = "apple-vision"
OCR_ENGINES = (OCR_ENGINE_PADDLE, OCR_ENGINE_APPLE_VISION)


class OCRBackend(Protocol):
    def recognize_image(self, image_path: Path, *, page: int) -> list[OCRItem]:
        ...


def normalize_ocr_engine(value: str | None) -> str:
    engine = (value or OCR_ENGINE_APPLE_VISION).strip().lower().replace("_", "-")
    aliases = {
        "paddleocr": OCR_ENGINE_PADDLE,
        "apple": OCR_ENGINE_APPLE_VISION,
        "vision": OCR_ENGINE_APPLE_VISION,
        "applevision": OCR_ENGINE_APPLE_VISION,
    }
    engine = aliases.get(engine, engine)
    if engine not in OCR_ENGINES:
        raise ValueError(f"Unsupported OCR engine: {value}")
    return engine


def create_ocr_backend(
    *,
    engine: str | None = None,
    lang: str = "ch",
    use_textline_orientation: bool = False,
) -> OCRBackend:
    normalized = normalize_ocr_engine(engine)
    if normalized == OCR_ENGINE_APPLE_VISION:
        return AppleVisionBackend(lang=lang)
    return PaddleOCRBackend(lang=lang, use_textline_orientation=use_textline_orientation)


class PaddleOCRBackend:
    """Thin lazy-loading wrapper around PaddleOCR."""

    def __init__(
        self,
        *,
        lang: str = "ch",
        use_doc_orientation_classify: bool = False,
        use_doc_unwarping: bool = False,
        use_textline_orientation: bool = False,
    ) -> None:
        self.lang = lang
        self.use_doc_orientation_classify = use_doc_orientation_classify
        self.use_doc_unwarping = use_doc_unwarping
        self.use_textline_orientation = use_textline_orientation
        self._ocr: Any | None = None

    @property
    def loaded(self) -> bool:
        return self._ocr is not None

    def _load(self) -> Any:
        if self._ocr is None:
            os.environ.setdefault(
                "PADDLE_PDX_CACHE_HOME",
                str(Path(".paddlex-cache").resolve()),
            )
            try:
                from paddleocr import PaddleOCR
            except ImportError as exc:
                raise RuntimeError(
                    "PaddleOCR is not installed. Install it with: "
                    'uv pip install -e ".[paddle]"'
                ) from exc

            try:
                self._ocr = PaddleOCR(
                    lang=self.lang,
                    use_doc_orientation_classify=self.use_doc_orientation_classify,
                    use_doc_unwarping=self.use_doc_unwarping,
                    use_textline_orientation=self.use_textline_orientation,
                )
            except TypeError:
                # PaddleOCR 2.x uses a different constructor naming scheme.
                self._ocr = PaddleOCR(
                    lang=self.lang,
                    use_angle_cls=self.use_textline_orientation,
                    show_log=False,
                )
        return self._ocr

    def recognize_image(self, image_path: Path, *, page: int) -> list[OCRItem]:
        ocr = self._load()

        if hasattr(ocr, "predict"):
            raw = ocr.predict(str(image_path))
        else:
            raw = ocr.ocr(str(image_path), cls=self.use_textline_orientation)

        return parse_paddle_result(raw, page=page, source=str(image_path))


class AppleVisionBackend:
    """Wrapper around the native apple-vision-ocr helper."""

    def __init__(self, *, lang: str = "ch", helper_path: Path | None = None) -> None:
        self.lang = lang
        self.helper_path = helper_path

    @property
    def loaded(self) -> bool:
        return self._resolve_helper_path().exists()

    def recognize_image(self, image_path: Path, *, page: int) -> list[OCRItem]:
        helper = self._resolve_helper_path()
        if not helper.exists():
            raise RuntimeError(
                "apple-vision-ocr helper is not available. "
                "Build it with: scripts/build_apple_vision_helper.sh"
            )

        command = [
            str(helper),
            str(image_path),
            "--page",
            str(page),
            "--source",
            str(image_path),
            "--lang",
            ",".join(to_apple_vision_languages(self.lang)),
        ]
        result = subprocess.run(command, capture_output=True, text=True, check=False)
        if result.returncode != 0:
            message = (result.stderr or result.stdout or "Apple Vision OCR failed.").strip()
            raise RuntimeError(message)

        return parse_apple_vision_result(result.stdout)

    def _resolve_helper_path(self) -> Path:
        if self.helper_path is not None:
            return self.helper_path.expanduser().resolve()

        env_path = os.environ.get("APPLE_VISION_OCR_BIN")
        if env_path:
            return Path(env_path).expanduser().resolve()

        root = Path(__file__).resolve().parents[2]
        candidates = [
            root / "apple-vision" / "bin" / "apple-vision-ocr",
            Path.cwd() / "apple-vision" / "bin" / "apple-vision-ocr",
        ]
        for candidate in candidates:
            if candidate.exists():
                return candidate.resolve()

        binary = shutil.which("apple-vision-ocr")
        if binary:
            return Path(binary).resolve()

        return candidates[0].resolve()


def to_apple_vision_languages(lang: str | None) -> list[str]:
    value = (lang or "ch").strip()
    if "," in value:
        return [item.strip() for item in value.split(",") if item.strip()]

    normalized = value.lower().replace("_", "-")
    mapping = {
        "ch": ["zh-Hans", "en-US"],
        "zh": ["zh-Hans", "en-US"],
        "cn": ["zh-Hans", "en-US"],
        "zh-cn": ["zh-Hans", "en-US"],
        "zh-hans": ["zh-Hans", "en-US"],
        "cht": ["zh-Hant", "en-US"],
        "tw": ["zh-Hant", "en-US"],
        "zh-tw": ["zh-Hant", "en-US"],
        "zh-hant": ["zh-Hant", "en-US"],
        "en": ["en-US"],
        "en-us": ["en-US"],
        "ja": ["ja-JP"],
        "jp": ["ja-JP"],
        "ja-jp": ["ja-JP"],
        "ko": ["ko-KR"],
        "kr": ["ko-KR"],
        "ko-kr": ["ko-KR"],
    }
    return mapping.get(normalized, [value])


def parse_apple_vision_result(raw: str | Any) -> list[OCRItem]:
    payload = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(payload, list):
        raise ValueError("Apple Vision OCR output must be a JSON list.")

    items: list[OCRItem] = []
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        items.append(
            OCRItem(
                page=int(entry.get("page") or 1),
                text=str(entry.get("text") or ""),
                source=str(entry.get("source") or ""),
                score=_safe_float(entry.get("score")),
                box=_to_float_list(entry.get("box")),
                polygon=_to_polygon(entry.get("polygon")),
            )
        )
    return items


def parse_paddle_result(raw: Any, *, page: int, source: str) -> list[OCRItem]:
    """Normalize common PaddleOCR 2.x and 3.x result shapes."""
    items: list[OCRItem] = []

    for result in _iter_result_objects(raw):
        if isinstance(result, dict):
            texts = _as_list(_first_present(result, ("rec_texts", "texts")))
            scores = _as_list(_first_present(result, ("rec_scores", "scores")))
            polygons = _as_list(_first_present(result, ("rec_polys", "dt_polys", "polys")))
            boxes = _as_list(_first_present(result, ("rec_boxes", "boxes")))
            for index, text in enumerate(texts):
                polygon = _to_polygon(_at(polygons, index))
                box = _to_float_list(_at(boxes, index)) or _polygon_to_box(polygon)
                items.append(
                    OCRItem(
                        page=page,
                        text=str(text),
                        score=_safe_float(_at(scores, index)),
                        box=box,
                        polygon=polygon,
                        source=source,
                    )
                )
            continue

        # PaddleOCR 3.x result objects often expose dict/json-like data.
        for attr in ("json", "res", "data"):
            value = getattr(result, attr, None)
            if value:
                nested = value() if callable(value) else value
                items.extend(parse_paddle_result(nested, page=page, source=source))
                break
        else:
            # PaddleOCR 2.x usually returns [[box, (text, score)], ...].
            if isinstance(result, (list, tuple)):
                items.extend(_parse_legacy_lines(result, page=page, source=source))

    return items


def _first_present(result: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        value = result.get(key)
        if value is not None:
            return value
    return []


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _iter_result_objects(raw: Any) -> list[Any]:
    if raw is None:
        return []
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, (list, tuple)):
        if raw and _looks_like_legacy_line(raw[0]):
            return [raw]
        return list(raw)
    return [raw]


def _parse_legacy_lines(lines: list[Any] | tuple[Any, ...], *, page: int, source: str) -> list[OCRItem]:
    items: list[OCRItem] = []
    for line in lines:
        if not _looks_like_legacy_line(line):
            continue
        polygon = _to_polygon(line[0])
        text_info = line[1]
        text = str(text_info[0]) if isinstance(text_info, (list, tuple)) and text_info else ""
        score = _safe_float(text_info[1]) if isinstance(text_info, (list, tuple)) and len(text_info) > 1 else None
        items.append(
            OCRItem(
                page=page,
                text=text,
                score=score,
                box=_polygon_to_box(polygon),
                polygon=polygon,
                source=source,
            )
        )
    return items


def _looks_like_legacy_line(value: Any) -> bool:
    return (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and isinstance(value[1], (list, tuple))
        and len(value[1]) >= 1
    )


def _at(values: Any, index: int) -> Any:
    try:
        return values[index]
    except Exception:
        return None


def _safe_float(value: Any) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _to_float_list(value: Any) -> list[float] | None:
    if value is None:
        return None
    if hasattr(value, "tolist"):
        value = value.tolist()
    if not isinstance(value, (list, tuple)):
        return None
    try:
        return [float(item) for item in value]
    except (TypeError, ValueError):
        return None


def _to_polygon(value: Any) -> list[list[float]] | None:
    if value is None:
        return None
    if hasattr(value, "tolist"):
        value = value.tolist()
    if not isinstance(value, (list, tuple)):
        return None

    polygon: list[list[float]] = []
    for point in value:
        if hasattr(point, "tolist"):
            point = point.tolist()
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            return None
        try:
            polygon.append([float(point[0]), float(point[1])])
        except (TypeError, ValueError):
            return None
    return polygon or None


def _polygon_to_box(polygon: list[list[float]] | None) -> list[float] | None:
    if not polygon:
        return None
    xs = [point[0] for point in polygon]
    ys = [point[1] for point in polygon]
    return [min(xs), min(ys), max(xs), max(ys)]
