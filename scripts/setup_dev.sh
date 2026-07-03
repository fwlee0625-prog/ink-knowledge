#!/usr/bin/env zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UV_BIN="${UV_BIN:-uv}"
PYTHON_VERSION="${PYTHON_VERSION:-3.12}"
INSTALL_PADDLE=0

for arg in "$@"; do
  case "$arg" in
    --paddle)
      INSTALL_PADDLE=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

cd "$ROOT_DIR"

echo "Project: $ROOT_DIR"
echo "Using project-local caches: .venv, .uv-cache, .paddlex-cache"

if [[ ! -d ".venv" ]]; then
  echo "Creating Python venv..."
  "$UV_BIN" --cache-dir .uv-cache venv .venv --python "$PYTHON_VERSION"
else
  echo "Python venv exists."
fi

echo "Installing Python dev dependencies..."
"$UV_BIN" --cache-dir .uv-cache pip install -e ".[dev]"

if [[ "$INSTALL_PADDLE" == "1" ]]; then
  echo "Installing PaddlePaddle CPU and PaddleOCR..."
  "$UV_BIN" --cache-dir .uv-cache pip install \
    paddlepaddle==3.2.0 \
    -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
  "$UV_BIN" --cache-dir .uv-cache pip install -e ".[paddle]"
else
  echo "Skipping PaddleOCR extension install. Re-run with --paddle to enable PaddleOCR."
fi

echo "Building Apple Vision helper..."
scripts/build_apple_vision_helper.sh

if [[ ! -d "node_modules" ]]; then
  echo "Installing frontend dependencies..."
  pnpm install
else
  echo "Frontend dependencies exist."
fi

echo "Generating example OCR assets..."
.venv/bin/mac-local-ocr-samples -o examples/ocr

echo "Done."
echo "Run frontend build: pnpm run build"
echo "Run Tauri dev app: pnpm run tauri"
