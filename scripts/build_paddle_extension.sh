#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
VERSION="${PADDLE_EXTENSION_VERSION:-0.1.0}"
UV_BIN="${UV_BIN:-uv}"
PYTHON_VERSION="${PYTHON_VERSION:-3.12}"
ARCH="$(uname -m)"
PACKAGE_NAME="paddle-engine-macos-${ARCH}-${VERSION}"
BUILD_ROOT="$ROOT_DIR/build/extensions"
PACKAGE_DIR="$BUILD_ROOT/$PACKAGE_NAME"
RUNTIME_DIR="$PACKAGE_DIR/runtime"
VENV_DIR="$RUNTIME_DIR/.venv"
BIN_DIR="$PACKAGE_DIR/bin"
CACHE_DIR="$PACKAGE_DIR/.uv-cache"

mkdir -p "$BIN_DIR" "$RUNTIME_DIR" "$CACHE_DIR"

echo "Building PaddleOCR extension: $PACKAGE_DIR"

if [[ ! -d "$VENV_DIR" ]]; then
  "$UV_BIN" --cache-dir "$CACHE_DIR" venv "$VENV_DIR" --python "$PYTHON_VERSION"
fi

PYTHON_BIN="$VENV_DIR/bin/python"

"$UV_BIN" --cache-dir "$CACHE_DIR" pip install --python "$PYTHON_BIN" \
  paddlepaddle==3.2.0 \
  -i https://www.paddlepaddle.org.cn/packages/stable/cpu/

"$UV_BIN" --cache-dir "$CACHE_DIR" pip install --python "$PYTHON_BIN" "$ROOT_DIR[paddle]"

cat > "$BIN_DIR/paddle-ocr-engine" <<'EOF'
#!/usr/bin/env zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$ROOT_DIR/runtime/.venv/bin/mac-local-ocr"

if [[ "${1:-}" == "recognize" ]]; then
  shift
fi

exec "$CLI" "$@"
EOF

chmod +x "$BIN_DIR/paddle-ocr-engine"

cat > "$PACKAGE_DIR/manifest.json" <<EOF
{
  "id": "paddle",
  "name": "PaddleOCR",
  "version": "$VERSION",
  "platform": "macos",
  "arch": "$ARCH",
  "entry": "bin/paddle-ocr-engine",
  "protocolVersion": 1,
  "capabilities": {
    "images": true,
    "pdf": true,
    "languages": ["ch", "en"],
    "textLayer": false,
    "requiresModelCache": true
  },
  "modelDir": "../../models/paddle"
}
EOF

rm -rf "$CACHE_DIR"

echo "Done: $PACKAGE_DIR"
echo "Import this directory from the app extension page."
