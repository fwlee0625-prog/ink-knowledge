#!/usr/bin/env bash
set -euo pipefail

export UV_CACHE_DIR="${UV_CACHE_DIR:-.uv-cache}"

uv run --no-sync mac-local-ocr-samples -o examples/ocr
uv run --no-sync mac-local-ocr examples/ocr/sample_cn_en.png -o output --format both --engine paddle
