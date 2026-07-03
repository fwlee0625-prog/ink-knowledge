# 墨识 OCR

墨识 OCR 是一个面向 macOS 的本地 OCR 工具，包含 Tauri 桌面应用、macOS 原生 OCR 后端和仍可独立运行的 Python CLI。OCR 在本机执行，默认不依赖付费 API。

## 功能

- 支持图片输入：`png`、`jpg`、`jpeg`、`bmp`、`tif`、`tiff`、`webp`
- 支持 PDF 输入：
  - PDF 页面已有文本层时，优先直接提取文本
  - 桌面基础版扫描页或使用 `--force-ocr` 时，通过 PDFKit/CoreGraphics 渲染后交给 Apple Vision
  - Python CLI 仍保留 PyMuPDF 链路，便于开发验证和 Paddle 扩展迁移
- 支持输出 `txt`、`json` 或两者同时输出
- JSON 保留 `page`、`text`、`score`、`box`、`polygon`、`source`
- 桌面版默认使用内置 `moshi-ocr-native` 做 Apple Vision 本机识别
- 桌面版识别完成后可在应用内预览 `txt/json` 结果，也可用系统默认应用打开或在 Finder 中定位
- PaddleOCR 作为扩展高精度引擎引入，未安装扩展时不会下载 PaddleOCR 或模型
- 可切换 OCR 引擎，后续可继续接入其他识别后端

## 仓库结构

```text
apple-vision/           Swift Apple Vision 原生后端和兼容 helper
src/mac_local_ocr/      Python OCR 核心、CLI、OCR 引擎适配
ui/                     Tauri 前端界面
  src/components/ui/       通用按钮、卡片、表单控件等基础组件
  src/components/features/ 按 OCR、后端、设置划分的业务组件
  src/lib/                 前端格式化、设置持久化等纯工具函数
src-tauri/              Tauri Rust 桌面壳
tests/                  Python 单元测试
tests/fixtures/         测试输入资产
examples/ocr/           用户可运行的 OCR 示例资产
scripts/                开发、安装、smoke 脚本
docs/                   架构和维护文档
output/                 本地运行输出，不提交
```

更多结构说明见 [docs/architecture.md](docs/architecture.md)。原生基础后端与 PaddleOCR 扩展化的重构方案见 [docs/native-backend-extension-refactor.md](docs/native-backend-extension-refactor.md)。

## 安装

建议在 macOS M2 上开发。桌面基础版依赖 Swift 原生后端；Python 3.12 主要用于 CLI、测试和 PaddleOCR 扩展开发。PaddleOCR / PaddlePaddle 对 Python 3.13 的兼容性通常不如 3.12 稳。

开发环境只需要初始化一次，之后会复用项目内的 `.venv/`、`.uv-cache/`、`node_modules/` 和 `.paddlex-cache/`：

```bash
pnpm run setup
```

默认 Apple Vision 引擎需要先构建原生后端：

```bash
pnpm run build:apple-vision
```

如果要启用 PaddleOCR 扩展引擎，再安装 Paddle 依赖：

```bash
pnpm run setup:paddle
```

开发期桌面后端会优先寻找当前项目的 `apple-vision/bin/moshi-ocr-native`。正式分发时，桌面 App 使用随包携带的原生后端，不再为基础 OCR 在用户机器上创建 `.venv`。PaddleOCR 后续通过扩展包安装入口启用。

构建可导入的 PaddleOCR 扩展目录：

```bash
scripts/build_paddle_extension.sh
```

脚本会生成 `build/extensions/paddle-engine-macos-<arch>-<version>/`，其中包含 `manifest.json`、`bin/paddle-ocr-engine` 和运行时环境。桌面 App 的「系统设置 > 扩展管理」可以导入这个扩展目录。

## CLI 示例

生成示例图片：

```bash
mac-local-ocr-samples -o examples/ocr
```

识别图片：

```bash
mac-local-ocr examples/ocr/sample_cn_en.png -o output --format both
```

使用 PaddleOCR 扩展引擎识别图片：

```bash
mac-local-ocr examples/ocr/sample_cn_en.png -o output --format both --engine paddle
```

识别 PDF：

```bash
mac-local-ocr examples/ocr/sample_text.pdf -o output --format both --dpi 300
```

强制 OCR PDF 每一页，即使页面已有文本层：

```bash
mac-local-ocr examples/ocr/sample_text.pdf -o output --force-ocr --dpi 300
```

## 桌面应用

本项目已引入 Tauri 前端骨架，目标只支持 macOS。桌面版采用原生基础后端加可选扩展的思路：

```text
Tauri 前端
  -> 首次启动检查 moshi-ocr-native
  -> Apple Vision 基础 OCR 直接可用
  -> PaddleOCR 等高精度能力从 App 数据目录的 engines/ 扩展加载
  -> 后续由 Tauri 调用内置原生后端或扩展后端
```

扩展目录导入后会复制到 App 数据目录：

```text
~/Library/Application Support/com.local.mac-ocr/engines/{engine}/{version}/
```

前端采用 React 组件分层：`ui/src/components/ui/` 放可复用基础组件，如按钮、卡片、字段、分段控制、开关、空状态和应用内确认弹框；`ui/src/components/features/` 按功能拆分 OCR 识别、后端状态、系统设置等业务组件；`ui/src/App.tsx` 只保留全局状态、Tauri 命令调用和页面切换。确认类交互优先使用 `useConfirmDialog` + `ConfirmDialog`，避免回退到系统默认弹窗导致视觉风格不统一。

识别页的结果区优先展示输出文件名，不在列表和预览列展示完整路径。预览列默认关闭，用户点击结果行或行内「预览」后，前端通过 `preview_result_file` 读取 `txt/json` 并在右侧单独展示；预览列右上角仅保留关闭图标按钮；行内的「打开」调用系统默认应用，「定位」在 Finder 中选中输出文件。

启动 Tauri 开发窗口前，先确认是否已有本地 dev server；本项目不会自动启动长期运行服务。

```bash
pnpm run tauri
```

打包 macOS 安装包：

```bash
pnpm run tauri:build
```

## 验证

不依赖 PaddleOCR 的基础验证：

```bash
python -m compileall src tests
python -m pytest
```

PaddleOCR 扩展 smoke 需要安装 PaddleOCR，首次运行可能下载模型：

```bash
bash scripts/smoke.sh
```

桌面前端静态检查：

```bash
pnpm install
pnpm run build
```

## 输出结构

`txt` 输出为纯文本，按页拼接。`json` 输出示例：

```json
{
  "input": "/absolute/path/input.pdf",
  "items": [
    {
      "page": 1,
      "text": "本地 OCR 测试",
      "source": "pdf_text_layer",
      "score": null,
      "box": null,
      "polygon": null
    }
  ],
  "text": "本地 OCR 测试"
}
```

`source` 说明：

- `pdf_text_layer`：来自 PDF 自带文本层，没有走 OCR
- 临时图片路径：来自 PDF 扫描页渲染后 OCR
- 原图片路径：来自图片 OCR

## 当前限制

- 表格结构、版面语义、Markdown 还原尚未实现
- PaddleOCR 2.x/3.x 返回结构存在差异，本项目做了基础兼容，复杂 PP-Structure 结果还需要单独适配
- PaddleOCR 对手写不是强项，手写、低清晰度、复杂表格或版面还原建议后续增加低置信度区域复核或视觉模型兜底
