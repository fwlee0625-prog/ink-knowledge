from mac_local_ocr.backends import (
    normalize_ocr_engine,
    parse_apple_vision_result,
    parse_paddle_result,
    to_apple_vision_languages,
)


def test_parse_paddle_legacy_result_shape():
    raw = [
        [
            [[0, 0], [100, 0], [100, 30], [0, 30]],
            ("Hello 123", 0.98),
        ]
    ]

    items = parse_paddle_result(raw, page=1, source="sample.png")

    assert len(items) == 1
    assert items[0].text == "Hello 123"
    assert items[0].score == 0.98
    assert items[0].polygon == [[0.0, 0.0], [100.0, 0.0], [100.0, 30.0], [0.0, 30.0]]


def test_parse_paddle_dict_result_shape():
    raw = {
        "rec_texts": ["本地 OCR", "A-1024"],
        "rec_scores": [0.93, 0.88],
        "rec_boxes": [[10, 20, 120, 50], [10, 60, 160, 90]],
    }

    items = parse_paddle_result(raw, page=2, source="page.png")

    assert [item.text for item in items] == ["本地 OCR", "A-1024"]
    assert items[0].page == 2
    assert items[1].box == [10.0, 60.0, 160.0, 90.0]


def test_normalize_ocr_engine_aliases():
    assert normalize_ocr_engine(None) == "apple-vision"
    assert normalize_ocr_engine("paddleocr") == "paddle"
    assert normalize_ocr_engine("apple_vision") == "apple-vision"
    assert normalize_ocr_engine("vision") == "apple-vision"


def test_to_apple_vision_languages_maps_common_values():
    assert to_apple_vision_languages("ch") == ["zh-Hans", "en-US"]
    assert to_apple_vision_languages("zh-Hant") == ["zh-Hant", "en-US"]
    assert to_apple_vision_languages("en") == ["en-US"]
    assert to_apple_vision_languages("zh-Hans,en-US") == ["zh-Hans", "en-US"]


def test_parse_apple_vision_result():
    raw = """
    [
      {
        "page": 1,
        "text": "本地 OCR 测试",
        "source": "sample.png",
        "score": 0.7,
        "box": [10, 20, 120, 50],
        "polygon": [[10, 20], [120, 20], [120, 50], [10, 50]]
      }
    ]
    """

    items = parse_apple_vision_result(raw)

    assert len(items) == 1
    assert items[0].text == "本地 OCR 测试"
    assert items[0].score == 0.7
    assert items[0].box == [10.0, 20.0, 120.0, 50.0]
