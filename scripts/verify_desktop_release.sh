#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_PATH="$ROOT_DIR/src-tauri/target/release/bundle/macos/墨识.app"
HELPER_IN_APP="$APP_PATH/Contents/Resources/_up_/macos-capture/bin/moshi-capture-helper"
OCR_NATIVE_IN_APP="$APP_PATH/Contents/Resources/_up_/apple-vision/bin/moshi-ocr-native"
APPLE_VISION_IN_APP="$APP_PATH/Contents/Resources/_up_/apple-vision/bin/apple-vision-ocr"
SELF_TEST_DIR="${TMPDIR:-/tmp}/moshi-release-self-test"

cd "$ROOT_DIR"

echo "== Release metadata =="
pnpm run release:check

echo "== Rust check =="
cargo check --manifest-path src-tauri/Cargo.toml

echo "== Desktop frontend/native build =="
CI=true pnpm run build:desktop

echo "== Capture helper smoke =="
zsh scripts/smoke_macos_capture_helper.sh

echo "== App-only bundle =="
CI=true pnpm exec tauri build --bundles app

echo "== Bundle resources =="
for file in "$HELPER_IN_APP" "$OCR_NATIVE_IN_APP" "$APPLE_VISION_IN_APP"; do
  if [[ ! -x "$file" ]]; then
    echo "missing executable resource: $file" >&2
    exit 1
  fi
  echo "$file"
done

echo "== Info.plist =="
MINIMUM_SYSTEM_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP_PATH/Contents/Info.plist")"
DISPLAY_NAME="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$APP_PATH/Contents/Info.plist")"
if [[ "$MINIMUM_SYSTEM_VERSION" != "14.0" ]]; then
  echo "expected LSMinimumSystemVersion 14.0, got $MINIMUM_SYSTEM_VERSION" >&2
  exit 1
fi
if [[ "$DISPLAY_NAME" != "墨识" ]]; then
  echo "expected CFBundleDisplayName 墨识, got $DISPLAY_NAME" >&2
  exit 1
fi

echo "== Bundled capture helper protocol/render self-test =="
"$HELPER_IN_APP" --validate-args --default-action save | grep -q '"ok":true'
SELF_TEST_JSON="$("$HELPER_IN_APP" --self-test-render --output-dir "$SELF_TEST_DIR")"
echo "$SELF_TEST_JSON" | grep -q '"action":"self-test"'
SELF_TEST_IMAGE="$(echo "$SELF_TEST_JSON" | sed -n 's/.*"imagePath":"\([^"]*\)".*/\1/p' | sed 's#\\/#/#g')"
if [[ ! -s "$SELF_TEST_IMAGE" ]]; then
  echo "expected bundled helper self-test image to exist and be non-empty" >&2
  exit 1
fi
echo "$SELF_TEST_IMAGE"

echo "desktop release verification passed"
