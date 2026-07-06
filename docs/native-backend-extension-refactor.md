# Native Backend and Extension Refactor Plan

本文档描述一次性重构目标：基础版彻底去除用户侧 Python/uv/venv 安装链路，改为 macOS 原生 Apple Vision 后端；PaddleOCR 和后续其他 OCR 能力统一作为可安装扩展引入。

## Goals

- 基础版安装后开箱可用，不要求用户安装 Python、uv、PaddleOCR 或命令行依赖。
- Apple Vision 成为内置默认 OCR 能力，负责图片和 PDF 扫描页识别。
- PDF 文本层提取、PDF 页面渲染、OCR 编排、txt/json 输出从 Python 迁移到原生后端。
- PaddleOCR 从当前 Python 可选依赖迁移为独立扩展包，不影响基础版安装体积和稳定性。
- 后续 RapidOCR、Tesseract、云端 OCR 或视觉模型可以沿同一扩展契约接入。
- release 包不再回退使用开发目录 `.venv`，避免本机开发环境污染分发验证。

## Current Implementation Status

- 已新增 `moshi-ocr-native recognize` 原生 CLI，支持图片、PDF 文本层、PDF 渲染 OCR、`txt/json/both` 输出。
- 已保留 `apple-vision-ocr IMAGE ...` 兼容入口，当前 Python `AppleVisionBackend` 仍可调用旧 helper 名称。
- Tauri 桌面基础 OCR 已切换为内置原生后端，release 不再回退开发目录 `.venv/bin/mac-local-ocr`。
- PaddleOCR 已从桌面基础后端中剥离为扩展查找路径：`Application Support/com.local.mac-ocr/engines/paddle/{version}/bin/paddle-ocr-engine`。
- 本地扩展目录导入、列举和卸载 UI 已实现；当前选择 PaddleOCR 且未安装扩展时会给出明确错误。
- 扩展导入后会读取 `manifest.json` 中的 `entry`，并执行入口 `--help` 做健康检查；OCR 调度不再硬编码 Paddle 入口文件名。
- 远程扩展索引、下载进度、压缩包解压和 SHA256 校验仍待接入发布服务。

## Non Goals

- 不在本次重构中实现 Windows/Linux 支持。
- 不在基础版内置 PaddleOCR、PaddlePaddle 或 Paddle 模型。
- 不把扩展安装实现为用户机器现场 `pip install`。
- 不改变现有 `txt`/`json` 输出语义，除非为坐标归一化补充字段。

## Target Architecture

```text
墨识.app
  Contents/Resources/
    moshi-ocr-native        macOS 原生基础后端
    apple-vision assets     如需保留的 helper 资源

Tauri desktop
  ui/                       前端页面、设置、扩展管理
  src-tauri/src/
    commands.rs             前端命令 DTO
    backend.rs              调用内置原生后端和扩展后端
    engine_registry.rs      引擎发现、状态、选择
    extension_manager.rs    扩展安装、校验、卸载

Application Support/com.local.mac-ocr/
  engines/
    paddle/
      0.1.0/
        manifest.json
        bin/paddle-ocr-engine
        runtime/
  models/
    paddle/
  output/
  cache/
```

基础识别链路：

```text
Tauri UI
  -> src-tauri command
  -> moshi-ocr-native recognize
      -> ImageIO / CoreGraphics 读取图片
      -> PDFKit 提取 PDF 文本层
      -> PDFKit / CoreGraphics 渲染扫描页
      -> Vision.framework OCR
      -> 输出 txt/json
```

扩展识别链路：

```text
Tauri UI
  -> src-tauri command
  -> engine registry 选择扩展
  -> engines/{engine}/{version}/bin/{engine}
      -> 按统一 CLI 协议输出 JSON
  -> Tauri 统一处理输出文件和错误
```

## Native Backend Scope

新增或升级 `apple-vision/` 下的 Swift 后端，建议命名为 `moshi-ocr-native`，覆盖当前 Python CLI 的基础能力。

### Required Capabilities

- 图片输入：`png`、`jpg`、`jpeg`、`bmp`、`tif`、`tiff`、`webp`。
- PDF 输入：
  - 默认优先提取文本层。
  - 文本层不足或启用 `--force-ocr` 时逐页渲染成图片后 OCR。
  - 支持 `--dpi` 控制渲染清晰度。
- 输出格式：`txt`、`json`、`both`。
- 输出字段保持兼容：
  - `input`
  - `items[].page`
  - `items[].text`
  - `items[].score`
  - `items[].box`
  - `items[].polygon`
  - `items[].source`
  - `text`
- 语言参数继续支持当前 `ch`、`en`、`zh-Hans`、`zh-Hant` 等映射。
- 错误输出必须可读，便于前端提示用户。

### Native APIs

- `Vision.framework`：`VNRecognizeTextRequest` 执行 OCR。
- `PDFKit.framework`：`PDFDocument`、`PDFPage.string` 提取文本层。
- `PDFKit/CoreGraphics`：按 DPI 渲染 PDF 页面。
- `ImageIO/CoreGraphics/AppKit`：读取图片并转换为 `CGImage`。
- `Foundation.Codable`：生成稳定 JSON。

### CLI Contract

内置原生后端和扩展后端都应支持同一类命令形态：

```bash
moshi-ocr-native recognize INPUT \
  --output-dir OUTPUT_DIR \
  --format txt|json|both \
  --engine apple-vision \
  --dpi 300 \
  --lang ch \
  --force-ocr
```

扩展后端可以忽略不支持的参数，但必须在 `manifest.json` 中声明能力。

## Extension Contract

每个扩展是一个独立目录，不依赖项目开发目录，不依赖用户全局 PATH。

```text
engines/{engine}/{version}/
  manifest.json
  bin/{entry}
  runtime/
  models/                 可选；大模型也可以放到全局 models/{engine}/
```

`manifest.json` 示例：

```json
{
  "id": "paddle",
  "name": "PaddleOCR",
  "version": "0.1.0",
  "platform": "macos",
  "arch": "arm64",
  "entry": "bin/paddle-ocr-engine",
  "protocolVersion": 1,
  "capabilities": {
    "images": true,
    "pdf": false,
    "languages": ["ch", "en"],
    "textLayer": false,
    "requiresModelCache": true
  },
  "modelDir": "../../models/paddle",
  "checksum": {
    "algorithm": "sha256",
    "value": ""
  }
}
```

扩展安装流程：

```text
选择本地扩展目录或读取远程扩展索引
  -> 用户确认安装
  -> 本地目录直接复制；远程包下载后校验 SHA256 并解压
  -> 写入 engines/{engine}/{version}
  -> 读取 manifest.json
  -> 执行 entry --help 健康检查
  -> 注册为可选 OCR 引擎
```

扩展卸载流程：

```text
停止正在运行的任务
  -> 删除 engines/{engine}/{version}
  -> 可选删除 models/{engine}
  -> 设置回退到 apple-vision
```

## PaddleOCR Extension Strategy

PaddleOCR 不再作为基础后端依赖安装。建议第一版 Paddle 扩展使用预构建包：

```text
paddle-engine-macos-arm64-0.1.0.tar.zst
  manifest.json
  bin/paddle-ocr-engine
  runtime/
  models/ or model downloader
```

实现路径优先级：

1. 使用当前 Python 适配层构建自包含运行时，保留已有 `parse_paddle_result` 兼容逻辑。
2. 后续评估 PaddleOCR-json 或其他预编译方案，降低 Python 运行时体积。
3. 模型缓存统一放到 `Application Support/com.local.mac-ocr/models/paddle`，不要散落在工作目录。

扩展包必须固定版本，不能在用户机器上临时解析最新依赖。

当前仓库提供本地扩展目录构建脚本：

```bash
scripts/build_paddle_extension.sh
```

输出目录：

```text
build/extensions/paddle-engine-macos-<arch>-<version>/
  manifest.json
  bin/paddle-ocr-engine
  runtime/.venv/
```

该目录可直接在桌面 App「后端」页面导入。后续发布到远程时，再将该目录打包并补充下载索引、SHA256 和签名校验。

## Migration Plan

### Phase 1: Stabilize Protocol

- 固定现有 JSON 输出结构并补充回归样例。
- 为原生后端和扩展后端定义统一 CLI 参数和错误格式。
- 在 `src-tauri` 中抽出 engine registry，先兼容当前 `mac-local-ocr`。

### Phase 2: Build Native Backend

- 将当前 `apple-vision-ocr` 升级为 `moshi-ocr-native`。
- 实现图片 OCR。
- 实现 PDF 文本层提取。
- 实现 PDF 页面按 DPI 渲染和 OCR。
- 输出与当前 Python CLI 对齐的 `txt`/`json`。

### Phase 3: Switch Desktop Default

- Tauri 默认调用 App bundle 内置 `moshi-ocr-native`。
- 移除 release 对项目 `.venv/bin/mac-local-ocr` 的回退。
- `check_backend` 改为检查内置后端和扩展后端状态。
- UI 默认引擎保持 `apple-vision`。

### Phase 4: Extension Manager

- 新增扩展目录规范和 `manifest.json` 解析。
- 新增本地扩展目录导入和卸载命令。
- UI 增加扩展状态展示、导入和卸载入口。
- PaddleOCR 作为第一个扩展接入，远程下载和校验仍待发布服务补齐。

### Phase 5: Remove User-Side uv Install

- 桌面端不再暴露基础后端安装命令，`scripts/install_backend.sh` 仅作为历史/开发脚本保留。
- `uv`、`.venv` 仅保留为开发和构建工具。
- README 将安装说明区分为开发环境和正式分发环境。

## Compatibility Rules

- `apple-vision` 永远是基础兜底引擎，扩展失败不能影响基础 OCR。
- 如果用户当前选择的扩展不可用，前端必须提示并允许切回 `apple-vision`。
- 扩展运行失败时不得删除用户输出目录或已有结果。
- 原生后端和扩展后端都不得依赖项目源码目录。
- release 包不得读取开发目录 `.venv`、`.uv-cache`、`.paddlex-cache`。
- 输出文件名、输出格式和主要 JSON 字段保持兼容，避免破坏用户脚本。

## Testing Checklist

- 干净 macOS 用户环境安装 DMG 后，不安装 Python/uv 也能识别图片。
- 干净 macOS 用户环境安装 DMG 后，不安装 Python/uv 也能识别 PDF 文本层。
- 扫描 PDF 在 `--force-ocr` 下能逐页 OCR。
- App 断网时 Apple Vision 基础 OCR 可用。
- 未安装 Paddle 扩展时，选择 Paddle 有明确提示。
- 安装 Paddle 扩展后能识别图片，并使用固定模型缓存目录。
- 删除 Paddle 扩展后基础 OCR 不受影响。
- release 构建机器保留项目 `.venv` 时，安装版也不能回退使用该 `.venv`。
- 输出 `txt`/`json` 与旧版样例保持兼容。

## Documentation Updates

完成重构时需要同步更新：

- `README.md`：区分用户安装、开发安装、扩展安装。
- `docs/architecture.md`：更新运行时边界，从 Python core 迁移到 native backend + extensions。
- 新增扩展开发文档：说明 `manifest.json`、CLI 协议、输出 JSON 和打包要求。
- 新增发布文档：说明基础 DMG、扩展包、校验和签名流程。
