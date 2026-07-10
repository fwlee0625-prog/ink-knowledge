# 墨识

墨识是一个面向 macOS 的本地识别与快捷工具箱，包含 Tauri 桌面应用、macOS 原生 OCR 后端和仍可独立运行的 Python CLI。OCR 在本机执行，默认不依赖付费 API；截图、截图 OCR、剪贴板和翻译作为桌面效率工具围绕“从屏幕/文档获取并处理内容”展开。

## 功能

- 支持图片输入：`png`、`jpg`、`jpeg`、`bmp`、`tif`、`tiff`、`webp`、`heic`、`heif`
- 支持 PDF 输入：
  - PDF 页面已有文本层时，优先直接提取文本
  - 桌面基础版扫描页或使用 `--force-ocr` 时，通过 PDFKit/CoreGraphics 渲染后交给 Apple Vision
  - Python CLI 仍保留 PyMuPDF 链路，便于开发验证和 Paddle 扩展迁移
- 支持输出 `txt`、`json` 或两者同时输出
- JSON 保留 `page`、`text`、`score`、`box`、`polygon`、`source`
- 桌面版默认使用内置 `moshi-ocr-native` 做 Apple Vision 本机识别
- 桌面版识别完成后可在应用内预览 `txt/json` 结果，也可用系统默认应用打开或在 Finder 中定位；设置中可控制重新识别时是否先清空旧的识别文件结果列表，并删除存储目录顶层的 `txt/json` 输出文件
- 桌面版不再使用主窗口内的 `OCR`/`设置` 顶部导航；`OCR` 和 `设置` 分别作为独立窗口，从菜单栏或全局快捷键打开，普通截图、截图 OCR、翻译弹框和剪贴板弹框也都不占用主工作台页面
- macOS 菜单栏会常驻墨识图标，启动后默认不展示主窗口并隐藏 Dock 图标，点击右上角图标可下拉使用 OCR、截屏、截图 OCR、翻译、剪贴板、设置和退出；OCR 与设置菜单项会创建或聚焦各自的独立窗口；菜单栏图标使用少留白的专用 template 图标，避免把 App 大图标缩成黑块或视觉尺寸偏小
- 关闭 OCR、设置、翻译或剪贴板等窗口不会结束后台托盘、快捷键、截图服务和剪贴板轮询；需要完全退出时使用菜单栏「退出墨识」
- 菜单项右侧会展示对应的全局快捷键提示，菜单宽度会随提示自动拓展，方便对照操作
- 托盘「截屏」使用启动时预热的 Swift/AppKit 常驻截图服务，点击后直接在当前桌面显示原生透明浮层，支持框选尺寸提示、8 点拖拽调整、选区拖拽移动、矩形、圆形、箭头、画笔、文字、撤销、OCR、另存为、关闭和确认复制；框选完成后默认不选中任何标注工具，选区、边角和工具栏会使用不同鼠标样式，工具栏以语义化图标展示，按钮悬浮时会显示正方形轻量背景
- 截图底层通过 ScreenCaptureKit 获取选区图像，标注在 Swift helper 内合成为最终 PNG；未配置截图目录时默认保存到 `~/Documents/墨识/Screenshots`，该目录已纳入 Tauri 本地资源访问范围以支持截图预览；剪贴板图片会落盘到 App 数据目录的 `clipboard-images/` 并同样纳入本地资源访问范围；`截图 OCR` 可框选后直接识别，识别文本会写入剪贴板，并在托盘模式下打开轻量 OCR 结果窗口
- OCR 结果窗口左侧展示截图预览和按 OCR `box` 坐标缩放叠加的识别框提示，右侧展示可编辑文本，并提供复制、翻译、重新识别等操作；重新识别使用设置页中配置的 OCR 引擎，结果窗口 header 不再提供引擎下拉和导出入口，右侧操作使用图标按钮；截图 OCR 完成后打开无标题栏透明独立浮窗，`#/ocr-result` 路由直接渲染窗口页面，不再在窗口内套 backdrop/dialog 弹框层，界面不展示关闭按钮，窗口存在期间可按 Esc 关闭，也会在点击其他窗口后失焦关闭；OCR 结果、翻译和剪贴板独立浮窗共用图钉、自动关闭、透明外边距、边界线与阴影外壳，固定后点击其他窗口不会触发失焦关闭，并通过 Rust 原生焦点事件兜底关闭；Esc 关闭同时有前端捕获阶段监听和 Rust 临时快捷键兜底，设置自动保存导致全局快捷键重载后会恢复该临时快捷键；header 通过 Tauri 原生窗口拖拽移动位置，复制成功会通过公共 Message 组件在窗口顶部显示轻量提示
- 剪贴板通过 macOS 系统剪贴板轮询自动捕获文本、图片和文件（文件仅存路径，不复制内容），历史持久化到本地 SQLite，支持搜索、类型筛选、置顶、源文件失效检测，以及将历史文本、图片或文件重新放回系统剪贴板使用；剪贴板入口会打开偏宽的独立轻量窗口并默认靠屏幕下方展示，设置中可在横向卡片和纵向列表两种样式之间切换，点击卡片会直接使用当前内容并关闭弹窗，窗口失焦或点击透明空白区域也会按自动关闭设置关闭，底部仅保留置顶和删除；历史条数上限会立即裁剪未置顶旧记录，置顶项不受上限影响，裁剪、清空和配置同步会清理不再被历史引用的图片缓存
- 设置中提供缓存管理页面，可查看 OCR 结果、截图、剪贴板历史和模型缓存分别占用的本机空间、文件数量及合计大小，并可勾选后清空
- 翻译支持多引擎：OpenAI 兼容 Chat Completions API，以及只需填写 AK/SK 的火山翻译；设置中点击左侧引擎卡片查看配置，点击卡片内「启用」按钮切换当前唯一使用的引擎；译文目标语言默认自动判断，也可在翻译弹框下方手动选择简体中文、英文、日文或韩文，文本会发送到对应服务端；复制原文或译文成功后会通过公共 Message 组件显示轻量提示
- 桌面版支持浅色、深色和跟随系统主题，系统外观变化时可自动切换
- PaddleOCR 作为扩展高精度引擎引入，未安装扩展时不会下载 PaddleOCR 或模型
- 可切换 OCR 引擎，后续可继续接入其他识别后端
- 为 OCR、截屏、截图 OCR、翻译、剪贴板、打开设置提供全局快捷键，默认绑定如下：`Alt+Shift+O`（OCR）、`Alt+Shift+S`（截屏）、`Alt+Shift+X`（截图 OCR）、`Alt+Shift+T`（翻译）、`Alt+Shift+V`（剪贴板）、`Alt+Shift+,`（打开设置）；快捷键可在「系统设置 > 快捷键」中自定义，控件失焦自动保存后立即生效
- 启动后会静默检查公开 GitHub 仓库的最新正式 Release；「系统设置 > 关于」可手动检查、下载新版 DMG，并查看随应用内置的完整更新日志

## 仓库结构

```text
apple-vision/           Swift Apple Vision 原生后端和兼容 helper
macos-capture/          Swift/AppKit 原生截图浮层、ScreenCaptureKit 截图 helper 和 NSPasteboard 读取 helper
src/mac_local_ocr/      Python OCR 核心、CLI、OCR 引擎适配
ui/                     Tauri 前端界面
  src/components/ui/       通用按钮、下拉选择、卡片、表单控件等基础组件
  src/components/features/ 按识别、截图、翻译、剪贴板、设置划分的业务组件
  src/lib/                 前端格式化、设置持久化等纯工具函数
src-tauri/              Tauri Rust 桌面壳
tests/                  Python 单元测试
tests/fixtures/         测试输入资产
examples/ocr/           用户可运行的 OCR 示例资产
scripts/                开发、安装、smoke 脚本
docs/                   架构和维护文档
release/                GitHub 仓库配置和生成的 Release Notes
output/                 本地运行输出，不提交
```

更多结构说明见 [docs/architecture.md](docs/architecture.md)。原生基础后端与 PaddleOCR 扩展化的重构方案见 [docs/native-backend-extension-refactor.md](docs/native-backend-extension-refactor.md)。

## 安装

建议在 macOS M2 上开发。桌面基础版依赖 Swift 原生后端；原生截图浮层使用 ScreenCaptureKit，桌面 App 最低支持 macOS 14。Python 3.12 主要用于 CLI、测试和 PaddleOCR 扩展开发。PaddleOCR / PaddlePaddle 对 Python 3.13 的兼容性通常不如 3.12 稳。

开发环境只需要初始化一次，之后会复用项目内的 `.venv/`、`.uv-cache/`、`node_modules/` 和 `.paddlex-cache/`：

```bash
pnpm run setup
```

默认 Apple Vision 引擎需要先构建原生后端：

```bash
pnpm run build:apple-vision
```

原生截图浮层需要构建 Swift helper；桌面完整构建会自动执行，也可以单独运行：

```bash
pnpm run build:macos-capture
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

前端采用 React 组件分层：`ui/src/components/ui/` 放可复用基础组件，如按钮、下拉选择、卡片、字段、分段控制、开关、空状态和应用内确认弹框；`ui/src/components/features/` 按功能拆分 OCR 识别、后端状态、系统设置等业务组件；`ui/src/App.tsx` 只保留全局状态、Tauri 命令调用和页面切换。桌面设置页视觉系统已对齐 shadcn/ui CLI 结构，项目根目录维护 `components.json`、`tailwind.config.ts` 和 shadcn CSS Variables；当前基础 UI 已通过官方 `pnpm dlx shadcn@latest add ...` 引入 `button`、`card`、`input`、`switch`、`toggle`、`toggle-group`、`alert`、`separator`、`select`、`tooltip` 和 `alert-dialog`，新增基础组件继续优先用该命令添加，不为 shadcn 额外引入 skills 或 MCP，图标统一使用 `lucide-react`。详细设计规范见 [docs/desktop-ui-design-system.md](docs/desktop-ui-design-system.md)。业务界面的下拉统一使用 `AppSelect` 薄封装，不直接写原生 `<select>`；密钥类输入统一使用 `SecretInput` 薄封装，复用 shadcn Input/Button 和 Eye/EyeOff 图标处理查看/隐藏；`AppSelect` 内部基于 shadcn Select，确认类交互通过 `useConfirmDialog` + `ConfirmDialog` 复用 shadcn AlertDialog，避免回退到系统默认弹窗导致视觉风格不统一。全局滚动条样式参考 Element Plus Scrollbar 的轻量浮层风格，在 `ui/src/styles.scss` 通过主题变量统一处理 thumb 尺寸、圆角、透明轨道和 hover/active 颜色，业务滚动容器只保留 `overflow` 边界。

桌面主布局由外层窗口 padding 控制边距，识别页和设置页内容随窗口宽度展开；设置独立窗口使用更紧凑的左右边距，左侧分类列表会为滚动条预留稳定间距，避免滚动条贴住菜单内容；OCR 和设置不再共享主窗口顶部导航，分别通过 `#/ocr`、`#/settings` 路由在独立窗口中直接渲染对应页面。OCR 页左侧提供图片、PDF、文件夹三个添加入口和拖拽区，拖拽区通过 Tauri 窗口拖拽事件接收真实本地路径，文件会追加去重到已选择列表并用不同图标区分图片与 PDF；已选择列表只展示文件名，悬浮后通过 tooltip 展示名称、路径和大小；文件夹会按递归层级展开为支持文件；识别引擎与输出格式也放在左侧 OCR 配置区，其中 TXT/JSON 输出格式以一行双选控件展示并保证至少保留一种格式。

系统设置采用分类结构：`通用`、`OCR`、`翻译`、`截图`、`剪贴板`、`缓存管理`、`快捷键`、`后端与扩展`、`关于`。`通用` 只保留界面主题等应用基础偏好；OCR 识别相关的存储目录、输出格式、引擎、语言、PDF 行为和重新识别前是否清空旧结果列表及旧输出文件统一放在 `OCR` 分类，其中语言使用下拉选择，覆盖简体中文、繁体中文、英文、日文和韩文。OCR 默认存储目录为用户文稿目录下的 `墨识/OCR`；截图未配置保存目录时默认写入用户文稿目录下的 `墨识/Screenshots`。翻译分类保持左侧引擎卡片、右侧配置表单的左右布局，点击卡片只切换查看和编辑哪个引擎配置，点击卡片内「启用」按钮才切换当前唯一使用的翻译引擎；右侧维护当前查看引擎密钥信息：OpenAI 兼容引擎配置 Base URL、API Key 和模型，火山翻译只配置 Access Key 与 Secret Key；切换引擎后写入本地设置，翻译弹框直接使用该引擎；译文目标语言默认自动判断，也可以在翻译弹框中手动指定。截图分类维护截图保存目录、临时文件和结果窗行为，不再提供普通截图后自动 OCR 开关；截图 OCR 已作为独立入口，触发后默认直接识别。`缓存管理` 分类通过后端统计 OCR 结果、截图、剪贴板历史记录与复制图片缓存、模型缓存的占用空间，展示各项大小、文件数量和总量；剪贴板历史为空时不把空 SQLite 容器文件算作缓存，点击清理按钮后可勾选需要清空的缓存区域。原一级「后端」入口已合并到「后端与扩展」，用于检查内置后端、查看 App 数据目录、导入或卸载 OCR 扩展。设置页维护最新草稿，控件变更后以 500ms 防抖按顺序写入 App 数据目录下的 `settings.db`，失焦、目录选择和显式重置等关键动作会立即 flush；旧版本 `localStorage` 设置会在首次加载时自动迁移到 SQLite，迁移时会丢弃旧版 `screenshotAutoOcr` 字段。`快捷键` 分类下可逐一修改各功能的全局快捷键，当前绑定使用 shadcn 风格 `Kbd` 键帽展示，留空表示不注册，自动保存时会通过 `register_shortcuts` 命令让 Rust 重新注册全局快捷键并重建托盘菜单，菜单项右侧提示会同步更新。

「关于」页面从 Tauri 包信息读取当前版本，并展示 `ui/src/data/changelog.json` 中按版本维护的完整更新日志。Rust 更新模块在每个应用进程启动后只请求一次 GitHub `releases/latest`，手动检查会复用同一状态缓存；发现更高 SemVer 后优先打开 Release 中的 DMG 资源，没有 DMG 时回退到 Release 详情页。启动检查失败不会打扰用户，手动检查失败才显示错误。详细协议和发布约定见 [docs/update-system.md](docs/update-system.md)。

设置页在窗口高度不足时会把左侧分类和右侧表单限制在面板内滚动；左侧分类滚动条与菜单卡片之间保留内边距；带恢复行为的分类会将「恢复默认」固定在设置面板底部，避免底部操作被窗口裁切。

系统设置的「通用」里可以切换界面主题：浅色、深色或跟随系统。主题偏好写入本地设置；选择跟随系统时，前端监听 `prefers-color-scheme` 并在系统外观变化后自动应用对应主题。

普通截图和截图 OCR 不在主窗口展示页面，只从菜单栏或全局快捷键触发。Tauri 启动后会预热 `macos-capture/bin/moshi-capture-helper --service` 常驻截图服务，托盘点击时通过 JSONL 指令复用同一个 Swift/AppKit 进程，避免每次冷启动；如果常驻服务异常，会自动回退到一次性 helper。Swift/AppKit 在当前桌面上直接创建透明置顶浮层，显示遮罩、蓝色选区、尺寸标签、8 个边角拖拽点、语义化图标标注工具和另存为/OCR/关闭/确认复制动作；框选完成后默认不选中矩形等标注工具，点击选区内部会移动选区并显示手型光标，拖拽边或角会二次调整大小并显示对应 resize 光标，工具栏空白区域不会显示框选光标或触发重新框选，只有主动选择标注工具后才会在选区内绘制标注。另存为、OCR 或确认复制动作发生后使用 ScreenCaptureKit 截取选区，Swift 侧先通过 `NSScreenNumber` 匹配同一个 `SCDisplay`，再把浮层记录的左上角选区坐标转换为 ScreenCaptureKit 的 display logical/display space 坐标，避免 Retina 或多屏场景下截取到另一块区域；标注仍按选区内左上角坐标通过 CoreGraphics 合成到最终 PNG。未配置截图保存目录时，双击选区的默认保存动作会写入 `~/Documents/墨识/Screenshots`；工具栏的下载/另存为按钮会弹出系统保存面板，由用户选择具体文件位置。普通 `截屏` 支持双击选区直接保存，工具栏里的 `OCR` 是快捷动作，会把当前截图送入现有 OCR 后端；`截图 OCR` 在框选完成后直接识别并打开轻量 OCR 结果窗口，不再挂在主工作台页面上。

识别页的结果区优先展示输出文件名，不在列表和预览列展示完整路径；文件名超过一行时以省略号截断，并通过 shadcn Tooltip 悬浮显示完整名称。预览列默认关闭，用户点击结果行或行内「预览」后，前端通过 `preview_result_file` 读取 `txt/json` 并在右侧单独展示；预览列右上角仅保留关闭图标按钮；行内的「打开」调用系统默认应用，「定位」在 Finder 中选中输出文件。

启动 Tauri 开发窗口前，先确认是否已有本地 dev server；本项目不会自动启动长期运行服务。

```bash
pnpm run tauri
```

运行桌面应用后，macOS 右上角菜单栏会出现墨识图标，主窗口和 Dock 图标默认隐藏。点击图标可下拉执行 `OCR`、`截屏`、`截图 OCR`、`翻译`、`剪贴板`、打开 `设置` 或退出应用；菜单项右侧会展示对应的全局快捷键提示，菜单宽度会随提示自动拓展。`OCR` 和 `设置` 会打开各自的独立普通窗口，`翻译` 和 `剪贴板` 会打开各自的独立无标题栏弹框；关闭这些窗口后应用继续在菜单栏后台运行。`截屏` 会先预检屏幕录制权限，再启动原生透明截图浮层，在当前界面上框选区域并添加常用标注，再另存为、确认复制或 OCR；双击选区仍直接保存到默认截图目录。若屏幕录制权限、原生 helper 或 OCR 后端异常，托盘入口会弹出系统错误提示。全局快捷键默认覆盖上述六个功能，可在 `系统设置 > 快捷键` 中自定义；快捷键按下后与菜单点击走同一分发路径，行为一致。

打包 macOS 安装包：

```bash
pnpm run tauri:build
```

## 发布新版本

首次发布前，在 `release/config.json` 中填写公开 GitHub 仓库：

```json
{
  "githubRepository": "owner/repo"
}
```

发布时先在 `ui/src/data/changelog.json` 顶部增加新版本，再同步版本号并生成 Release Notes：

```bash
pnpm release:prepare -- 0.2.0
zsh scripts/verify_desktop_release.sh
gh release create v0.2.0 src-tauri/target/release/bundle/dmg/墨识_0.2.0_*.dmg \
  --title "墨识 v0.2.0" \
  --notes-file "release/release-notes.md"
```

`release:prepare` 会同步 `package.json`、`src-tauri/tauri.conf.json` 和 `src-tauri/Cargo.toml`；发布校验会检查三处版本和更新日志首项一致。GitHub 仓库也可在构建时通过 `MOSHI_GITHUB_REPOSITORY=owner/repo` 覆盖，但正式发布仍建议提交配置文件。

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

原生截图 helper smoke 不会启动截图浮层；它会校验参数协议，并生成一张包含矩形、圆形、箭头、画笔和文字标注的自检 PNG，覆盖标注合成路径：

```bash
zsh scripts/smoke_macos_capture_helper.sh
```

桌面 release 非 GUI 验证会串联 Rust check、前端/原生构建、helper smoke、app-only 打包、包内 helper 和 Info.plist 检查，不启动应用：

```bash
zsh scripts/verify_desktop_release.sh
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
