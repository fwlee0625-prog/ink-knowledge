#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
HELPER="$ROOT_DIR/macos-capture/bin/moshi-capture-helper"

if [[ ! -x "$HELPER" ]]; then
  "$ROOT_DIR/scripts/build_macos_capture_helper.sh" "$ROOT_DIR" >/dev/null
fi

SMOKE_OUTPUT_DIR="${TMPDIR:-/tmp}/moshi-capture-helper-smoke"

"$HELPER" --validate-args --default-action save | grep -q '"ok":true'
"$HELPER" --validate-args --default-action copy | grep -q '"ok":true'
"$HELPER" --validate-args --default-action ocr | grep -q '"ok":true'
"$HELPER" --validate-args --output-dir "$SMOKE_OUTPUT_DIR" --default-action save | grep -q '"ok":true'
SERVICE_READY_JSON="$(printf '{"command":"ping"}\n{"command":"shutdown"}\n' | "$HELPER" --service)"
echo "$SERVICE_READY_JSON" | grep -q '"action":"ready"'
echo "$SERVICE_READY_JSON" | grep -q '"action":"shutdown"'

SELF_TEST_JSON="$("$HELPER" --self-test-render --output-dir "$SMOKE_OUTPUT_DIR")"
echo "$SELF_TEST_JSON" | grep -q '"action":"self-test"'
SELF_TEST_IMAGE="$(echo "$SELF_TEST_JSON" | sed -n 's/.*"imagePath":"\([^"]*\)".*/\1/p' | sed 's#\\/#/#g')"
if [[ ! -s "$SELF_TEST_IMAGE" ]]; then
  echo "expected self-test image to exist and be non-empty" >&2
  exit 1
fi

if "$HELPER" --validate-args --default-action bad >/tmp/moshi-capture-helper-smoke.out 2>&1; then
  echo "expected invalid default action to fail" >&2
  exit 1
fi

grep -q '"action":"error"' /tmp/moshi-capture-helper-smoke.out
grep -q '不支持的默认动作' /tmp/moshi-capture-helper-smoke.out

echo "moshi-capture-helper smoke passed"
