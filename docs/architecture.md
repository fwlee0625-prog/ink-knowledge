# Architecture

本文档描述仓库的维护边界。目录命名优先回答两个问题：代码属于哪个运行时，以及文件是源码、示例、测试资产还是本地运行产物。

## Runtime Boundaries

```text
Python package
  src/mac_local_ocr/
    models.py       OCR 输出模型
    backends.py     PaddleOCR 适配和结果归一化
    document.py     图片/PDF 识别编排
    cli.py          命令行入口和输出写入
    samples.py      示例图片生成

Native macOS backend
  apple-vision/
    AppleVisionOCR.swift  moshi-ocr-native 和 apple-vision-ocr 兼容入口
    bin/moshi-ocr-native  桌面基础 OCR 后端，构建产物
    bin/apple-vision-ocr  旧 Python AppleVisionBackend 兼容 helper

Tauri desktop
  ui/               Web 前端
    src/App.tsx                 前端状态编排、Tauri 命令调用、页面切换
    src/components/ui/          可复用基础 UI 组件
    src/components/features/    按业务功能拆分的页面组件
    src/lib/                    前端纯工具函数和本地设置持久化
  src-tauri/src/
    main.rs         Tauri 启动装配
    commands.rs     前端可调用命令和 DTO，包括结果预览、系统打开和 Finder 定位
    backend.rs      原生后端检测、扩展后端发现、OCR 进程调用
    paths.rs        App 数据目录、项目根目录、PATH 解析
```

Python 核心不直接依赖 Tauri，当前保留为 CLI、测试和 PaddleOCR 扩展迁移基础。桌面基础 OCR 已切换为 `moshi-ocr-native`，通过 Swift/PDFKit/CoreGraphics/Vision 完成图片、PDF 文本层和扫描页识别。

前端层按「基础 UI」和「业务组件」拆分。`components/ui` 只沉淀按钮、卡片、字段、开关、分段控制、空状态和应用内确认弹框等无业务语义组件；`components/features` 按 OCR、后端依赖、系统设置等功能组织业务视图；`App.tsx` 保持为状态和命令编排层，避免继续承载大段页面结构。识别结果的预览状态留在 OCR 业务组件内，Tauri 命令只负责读取文本结果、系统打开和文件定位，不反向耦合 OCR 进程调用。

目标架构是 Apple Vision 内置默认可用，PaddleOCR 及其他引擎通过扩展包引入。完整方案见 [native-backend-extension-refactor.md](native-backend-extension-refactor.md)。

## Asset Boundaries

```text
examples/ocr/       给用户和 smoke 命令使用的可运行示例
tests/fixtures/     单元测试或集成测试输入
output/             本地运行输出，不提交
input/              本地临时输入，不提交
```

示例资产可以提交，用于 README、smoke 和人工验证。测试夹具只服务测试，不承担用户文档入口。

## Change Guidelines

- 新桌面基础 OCR 能力优先加在 `apple-vision/AppleVisionOCR.swift` 或拆到 `apple-vision/` 下的 Swift 模块；Python CLI 后端仍加在 `src/mac_local_ocr/backends.py` 或拆到 `src/mac_local_ocr/backends/`。
- 新输入格式优先扩展 `document.py`，保持 CLI 参数层薄。
- 新桌面命令先在 `commands.rs` 定义 DTO 和命令，再把具体执行逻辑放到领域模块。
- 输出文件预览只读取 `txt/json` 等文本产物，列表和预览列只展示输出文件名，不展示完整路径；预览列默认关闭，由用户点击结果行或「预览」打开，预览头部只保留关闭图标；打开和定位由列表行命令调用系统能力完成。
- 新前端通用样式或交互优先沉淀到 `ui/src/components/ui/`；和 OCR、后端、设置等业务强绑定的结构放到 `ui/src/components/features/`。
- 新确认类交互优先复用 `ui/src/components/ui/useConfirmDialog.tsx` 和 `ConfirmDialog.tsx`，保持应用内系统风格，不直接使用浏览器或系统默认 confirm。
- 不把 `.venv/`、`.uv-cache/`、`.paddlex-cache/`、`node_modules/`、`dist/`、`src-tauri/target/` 放进仓库。
