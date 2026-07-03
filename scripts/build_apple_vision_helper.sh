#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
SOURCE="$ROOT_DIR/apple-vision/AppleVisionOCR.swift"
OUTPUT_DIR="$ROOT_DIR/apple-vision/bin"
NATIVE_OUTPUT="$OUTPUT_DIR/moshi-ocr-native"
LEGACY_OUTPUT="$OUTPUT_DIR/apple-vision-ocr"
MODULE_CACHE="$ROOT_DIR/.swift-module-cache"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun not found. Install Xcode command line tools first." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR" "$MODULE_CACHE"

xcrun swiftc \
  -O \
  -module-cache-path "$MODULE_CACHE" \
  -framework AppKit \
  -framework Vision \
  -framework ImageIO \
  -framework CoreGraphics \
  -framework PDFKit \
  "$SOURCE" \
  -o "$NATIVE_OUTPUT"

cp "$NATIVE_OUTPUT" "$LEGACY_OUTPUT"

echo "$NATIVE_OUTPUT"
