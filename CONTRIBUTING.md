# Contributing

欢迎贡献。这个项目目前按 Python OCR 核心、Tauri 桌面壳、示例资产和测试资产分层维护。

## Local Checks

```bash
python -m compileall src tests
python -m pytest
pnpm run build
```

完整 OCR smoke 需要安装 PaddleOCR：

```bash
bash scripts/smoke.sh
```

## Structure Rules

- 用户可运行示例放在 `examples/ocr/`。
- 测试输入放在 `tests/fixtures/`。
- 本地输出放在 `output/`，不要提交。
- Tauri 命令入口放在 `src-tauri/src/commands.rs`，具体执行逻辑放在独立模块。
