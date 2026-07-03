#!/usr/bin/env zsh
set -euo pipefail

BACKEND_ROOT="${1:-$(pwd)}"
APP_DATA="${2:-$BACKEND_ROOT}"
UV_BIN="${UV_BIN:-uv}"
INSTALL_PADDLE="${INSTALL_PADDLE:-0}"

for arg in "${@:3}"; do
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

VENV_DIR="$APP_DATA/.venv"
CACHE_DIR="$APP_DATA/.uv-cache"
PADDLE_PDX_CACHE_HOME="$APP_DATA/.paddlex-cache"

mkdir -p "$APP_DATA" "$CACHE_DIR" "$PADDLE_PDX_CACHE_HOME"

echo "Backend root: $BACKEND_ROOT"
echo "App data: $APP_DATA"
if [[ ! -d "$VENV_DIR" ]]; then
  echo "Creating venv..."
  "$UV_BIN" --cache-dir "$CACHE_DIR" venv "$VENV_DIR" --python 3.12
else
  echo "Python venv exists."
fi

PYTHON_BIN="$VENV_DIR/bin/python"

echo "Installing base backend..."
"$UV_BIN" --cache-dir "$CACHE_DIR" pip install --python "$PYTHON_BIN" "$BACKEND_ROOT"

if [[ "$INSTALL_PADDLE" == "1" ]]; then
  echo "Installing PaddlePaddle CPU..."
  "$UV_BIN" --cache-dir "$CACHE_DIR" pip install --python "$PYTHON_BIN" \
    paddlepaddle==3.2.0 \
    -i https://www.paddlepaddle.org.cn/packages/stable/cpu/

  echo "Installing PaddleOCR extension..."
  "$UV_BIN" --cache-dir "$CACHE_DIR" pip install --python "$PYTHON_BIN" "$BACKEND_ROOT[paddle]"
else
  echo "Skipping PaddleOCR extension install."
fi

echo "Done."
