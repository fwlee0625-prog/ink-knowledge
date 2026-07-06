#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
SOURCE="$ROOT_DIR/macos-capture/MoshiPasteboardReader.swift"
OUTPUT_DIR="$ROOT_DIR/macos-capture/bin"
OUTPUT="$OUTPUT_DIR/moshi-pasteboard-reader"
MODULE_CACHE="$ROOT_DIR/.swift-module-cache"
ARCH="$(uname -m)"

if ! command -v xcrun >/dev/null 2>&1; then
  echo "xcrun not found. Install Xcode command line tools first." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR" "$MODULE_CACHE"

xcrun swiftc \
  -O \
  -target "$ARCH-apple-macos14.0" \
  -module-cache-path "$MODULE_CACHE" \
  -framework AppKit \
  -framework Foundation \
  -framework UniformTypeIdentifiers \
  "$SOURCE" \
  -o "$OUTPUT"

echo "$OUTPUT"
