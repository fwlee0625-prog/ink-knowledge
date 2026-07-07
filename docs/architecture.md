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
  macos-capture/
    MoshiCaptureHelper.swift  Swift/AppKit 原生截图浮层、标注和 ScreenCaptureKit 选区截图
    MoshiPasteboardReader.swift  NSPasteboard 读取 helper，一次性 CLI 输出文本/图片/文件 JSON
    bin/moshi-capture-helper  原生截图 helper，构建产物
    bin/moshi-pasteboard-reader  剪贴板读取 helper，构建产物

Tauri desktop
  ui/               Web 前端
    src/App.tsx                 前端状态编排、Tauri 命令调用、页面切换
    src/components/ui/          可复用基础 UI 组件，如按钮、下拉选择、字段和确认弹框
    src/components/features/    按业务功能拆分的页面组件
    src/lib/                    前端纯工具函数和本地设置持久化
  src-tauri/src/
    main.rs         Tauri 启动装配
    commands.rs     前端可调用命令和 DTO，包括结果预览、截图、翻译和剪贴板
    backend.rs      原生后端检测、扩展后端发现、OCR 进程调用
    screenshot.rs   截图保存、复制到剪贴板和输出目录工具
    native_capture.rs Swift 原生截图 helper 启动、结果解析和截图 OCR 编排
    ocr_result_window.rs 托盘截图 OCR 的轻量结果窗口数据缓存和窗口创建；窗口为无标题栏透明独立浮层（decorations=false），不绘制主页面或遮罩，显示时聚焦以支持失焦自动关闭，通过临时 Esc 快捷键兜底关闭，前端不展示关闭按钮并通过 Tauri startDragging 支持 header 原生拖拽移动
    screenshot_ocr.rs 截图 OCR 编排，复用现有 OCR 后端
    translation.rs  多引擎翻译分发，包含 OpenAI 兼容 Chat Completions 请求和火山翻译 AK/SK 签名请求
    clipboard.rs    系统剪贴板文本读写（pbpaste/pbcopy）
    clipboard_repo.rs  剪贴板历史 SQLite 持久化（rusqlite，WAL 模式），建表、去重、容量裁剪、置顶和源文件失效检测
    settings_repo.rs  系统设置 SQLite 持久化，按 key 保存 JSON，便于前端字段演进
    storage.rs      缓存占用统计和清理，按功能汇总 OCR 结果、截图、剪贴板和模型缓存大小
    native_pasteboard.rs  NSPasteboard 轮询编排，调用 Swift helper、敏感内容过滤、变更事件 emit
    tray.rs          macOS 菜单栏图标、下拉菜单和窗口唤起事件；菜单项 ID 与 shortcut action ID 共用，菜单点击和全局快捷键走同一 `dispatch_action` 分发路径
    shortcuts.rs    全局快捷键绑定（ShortcutBindings）、加速器校验和注册逻辑；`register_all` 会先注销已有快捷键再注册新绑定，并调用 `tray::rebuild_menu` 让菜单项右侧提示同步更新
    paths.rs        App 数据目录、项目根目录、PATH 解析
```

Python 核心不直接依赖 Tauri，当前保留为 CLI、测试和 PaddleOCR 扩展迁移基础。桌面基础 OCR 已切换为 `moshi-ocr-native`，通过 Swift/PDFKit/CoreGraphics/Vision 完成图片、PDF 文本层和扫描页识别。

前端层按「基础 UI」和「业务组件」拆分。`components/ui` 只沉淀按钮、下拉选择、卡片、字段、开关、分段控制、空状态、公共 Message 和应用内确认弹框等无业务语义组件；`components/features` 按识别、截图、OCR 结果窗口、翻译、剪贴板和设置组织业务视图；`App.tsx` 保持为状态和命令编排层，避免继续承载大段页面结构。下拉选择统一由 `AppSelect` 承载，参考 shadcn Select 的 button trigger、portal content、option item 和 selected indicator 模式，组件内部处理展开收起、外部点击、方向键/Enter/Escape 键盘交互和 viewport 内定位，业务层只传入 `options/value/onChange`。全局滚动条样式参考 Element Plus Scrollbar 的轻量视觉处理，由 `ui/src/styles.scss` 中的 `--scrollbar-*` 主题变量集中定义，并通过标准 `scrollbar-color/scrollbar-width` 与 WebKit scrollbar 伪元素统一应用到滚动容器；业务组件只负责 `overflow` 和滚动边界，不单独维护滚动条颜色与圆角。识别结果的预览状态留在 OCR 业务组件内，Tauri 命令只负责读取文本结果、系统打开和文件定位，不反向耦合 OCR 进程调用。公共 Message 参考 shadcn Sonner 的根级 `Toaster` 与调用式 `toast` 模式实现：`ui/src/main.tsx` 注入 `MessageProvider`，业务组件通过 `useMessage()` 触发 success/error/info/warning 轻量提示；翻译失败仍保留按钮行右侧红色错误，复制原文、译文和 OCR 文本成功统一走公共 Message。前端样式入口统一为 `ui/src/styles.scss`，不再使用 UnoCSS 或原子类生成插件。

桌面一级导航保留工具入口：`OCR`、`翻译`、`剪贴板`、`设置`。普通截图和截图 OCR 不进入主窗口导航，只从菜单栏或全局快捷键触发；后端管理不再是一级入口，统一归入 `设置 -> 后端与扩展`。设置页分类为 `通用`、`OCR`、`翻译`、`截图`、`剪贴板`、`缓存管理`、`快捷键`、`后端与扩展`、`关于`；其中 `通用` 只保留界面主题等应用基础偏好，OCR 输出目录、输出格式、引擎、语言、PDF 行为和 `clearOcrResultsBeforeRun` 重新识别清理策略归入 `OCR` 分类。该策略开启时，前端会在批量识别循环前调用 `clear_ocr_output_dir`，由 Rust 删除 OCR 存储目录顶层的 `txt/json` 输出文件并清空当前结果列表；关闭时保留旧结果并追加本次结果。翻译分类不再维护总开关，左侧只选择当前配置的引擎面板，右侧用 `translationOpenaiEnabled`、`translationVolcEnabled` 分别管理各引擎启用状态；`translationEngine` 作为翻译页默认引擎，由翻译页下拉在已启用引擎中选择并持久化。原文和译文语言不再持久化为用户设置，Rust 侧统一根据文本内容自动决定方向：简体中文译为英文，其他语言译为简体中文。OpenAI 兼容引擎保留 Base URL、API Key 和模型配置；火山翻译引擎只暴露 Access Key 与 Secret Key，由 Rust 侧按火山签名协议访问 `translate.volcengineapi.com`。OCR 结果默认写入用户文稿目录下的 `墨识/OCR`；截图未配置保存目录时默认写入用户文稿目录下的 `墨识/Screenshots`。截图分类维护结果窗行为偏好，`ocrResultAutoCloseOnBlur` 默认开启，控制独立结果窗获得焦点后失焦是否自动关闭。缓存管理分类调用 `get_storage_usage` 和 `clear_storage_cache`，由 `storage.rs` 在后端统计并清理 OCR txt/json 结果、截图图片、剪贴板历史记录与复制图片缓存、`models/` 模型缓存；剪贴板历史为空时不把空 SQLite 容器文件算作缓存，前端展示各项大小、文件数、路径和合计值，点击清理后才显示各区域勾选框。设置页由 `SettingsPage` 维护最新草稿，控件变更后交给 `App.tsx` 以 500ms 防抖调用 `save_app_settings`，并通过串行队列写入 App 数据目录下的 `settings.db`；失焦、目录选择和显式重置等关键动作会立即 flush。旧版本 `localStorage` 设置会在 SQLite 为空时自动迁移一次，迁移成功后清理旧 key。只有序列化内容变化时才同步快捷键与剪贴板后端配置。

设置页使用独立的面板滚动边界：`.settings-layout` 负责左右分栏，`.settings-sidebar` 与 `.settings-scroll` 分别承载分类列表和当前分类内容的内部滚动，`.settings-actions` 留在滚动区外侧固定显示恢复默认操作。新增设置分类或较长表单时，应继续通过 `SettingsSection` 保持「内容可滚动、底部操作可见」的结构。

macOS 菜单栏入口由 `src-tauri/src/tray.rs` 独立维护，启动时注册右上角常驻图标和下拉菜单。应用启动默认隐藏主窗口和 Dock 图标，并把 activation policy 设为 accessory；主窗口收到系统关闭请求时由 `main.rs` 阻止销毁并改为隐藏窗口，避免左上角关闭按钮结束后台托盘、快捷键、截图服务和剪贴板轮询，真正退出只走托盘「退出墨识」。托盘图标使用代码生成的透明 template 图标，让 macOS 按浅色/深色菜单栏自动着色，并把主体控制在接近 16x16 的视觉盒内，避免直接缩放 App 图标导致黑块或透明留白过大导致图标偏小；托盘「OCR」会唤起主窗口并切换到文件识别页面，托盘「翻译」会唤起主窗口并切换到翻译页面；托盘「截屏」和「截图 OCR」优先复用启动时预热的 `macos-capture/bin/moshi-capture-helper --service` 常驻截图服务，不打开主工作台窗口，服务异常时 Rust 侧回退到一次性 helper；如果 helper、屏幕录制权限或 OCR 后端失败，托盘入口会弹出系统错误提示，避免静默失败；「设置」仍可唤起主窗口并切换到对应页面。

全局快捷键由 `src-tauri/src/shortcuts.rs` 统一管理。`ShortcutBindings` 是面向前后端的 DTO，字段名即功能 ID（`ocr`、`screenshot`、`screenshotOcr`、`translation`、`clipboard`、`settings`），值为 Tauri Accelerator 字符串，空字符串表示不注册该快捷键。`register_all` 先调用 `unregister_all` 清空旧绑定，再用 `GlobalShortcutExt::on_shortcut` 逐个注册新加速器，handler 收到 `Pressed` 事件时调用 `tray::dispatch_action(handle, id)`，与菜单点击共用同一分发路径，保证两条入口行为一致。注册完成后 `register_all` 会调用 `tray::rebuild_menu` 重建托盘菜单，让菜单项右侧的快捷键提示（`MenuItem::with_id` 第 5 个参数传入 accelerator）与最新绑定同步，菜单宽度也会随提示自动拓展；如果 OCR 结果窗口此时仍打开，还会调用 `ocr_result_window::restore_close_shortcut_if_open` 恢复 Esc 临时关闭快捷键，避免设置自动保存重载全局快捷键时把独立浮窗的关闭兜底注销掉。启动时 `main.rs` 先注册默认绑定，前端加载本地设置后通过 `register_shortcuts` 命令覆盖；用户在「系统设置 > 快捷键」修改绑定并让控件失焦后，前端会再次调用 `register_shortcuts` 让绑定立即生效。`ShortcutBindings` 通过 `tauri-plugin-global-shortcut` 的 `ShortcutWrapper::try_from` 校验加速器格式，避免非法字符串进入注册流程。

截图浮层由 Swift/AppKit 原生实现，不经过 WebView。`MoshiCaptureHelper.swift` 支持一次性 CLI 和 `--service` JSONL 常驻模式；常驻模式平时只保留 Swift 进程和 AppKit event loop，收到 `capture` 指令后才创建浮层并在完成后清理窗口，返回带 `requestId` 的一行 JSON。创建浮层前会预检并请求屏幕录制权限，再为每个 `NSScreen` 创建透明、无边框、置顶的 `NSPanel`，在当前桌面上直接绘制半透明遮罩、蓝色选区、尺寸提示、8 个边角拖拽点、矩形、圆形、箭头、画笔、文字、撤销、OCR、另存为、关闭和确认复制工具。工具栏使用 Swift 绘制语义化图标，不依赖文字标签；按钮悬浮时显示正方形轻量灰色背景，工具栏空白区域使用普通箭头光标并拦截点击，避免误触发重新框选。框选完成后默认处于移动/调整状态，不默认选中矩形标注工具，点击选区内部会拖拽移动并使用手型光标，拖拽四边或四角手柄会二次调整大小并使用横向、纵向或斜向 resize 光标。文字标注使用浮层内联输入，不依赖可能被置顶窗口遮挡的系统 modal。另存为、OCR 或确认复制动作发生后，helper 先隐藏浮层，再通过 `NSScreenNumber` 匹配当前浮层所在的 `SCDisplay`，把浮层左上角选区坐标转换为 ScreenCaptureKit 的 display logical/display space 坐标后异步获取选区图像，避免 AppKit 底部原点坐标混入截图 API 导致偏移；Swift 内继续用选区内左上角标注坐标和 CoreGraphics bitmap context 把底图和标注矢量合成为最终 PNG。默认保存动作继续写入设置中的截图输出目录；工具栏另存为动作使用 `NSSavePanel` 让用户选择具体文件位置。该路径要求 macOS 14 或更高版本；第一版不包含长截图、贴图、马赛克或固定到屏幕。

截图和截图 OCR 是两个独立功能。普通截图通过菜单栏入口触发，不在主窗口展示页面；工具栏的 `OCR` 只是快捷动作，会把当前截图交给 OCR 后端。`截图 OCR` 入口同样使用原生浮层，但默认支持双击选区直接 OCR，并且不再提供主窗口页面入口。Rust 侧 `native_capture.rs` 负责启动 helper、解析 JSON、校验输出 PNG，并在 OCR 动作完成后把识别文本写入剪贴板，同时向前端发送 `native-capture-finished` 事件；`screenshot.rs` 统一处理截图输出目录，未传入目录时使用 `~/Documents/墨识/Screenshots`，再不可用时回退到 App 数据目录。截图 OCR 结果不再存入主工作台的全局弹框状态，主窗口打开时也不会在当前页面上叠加结果弹框；所有截图 OCR 完成入口统一调用 `ocr_result_window.rs` 创建或更新 `#/ocr-result` 轻量结果窗口。窗口加载后通过 `get_pending_ocr_result` 拉取最近一次截图 OCR 结果，避免依赖主工作台可见性。该窗口是无标题栏透明独立窗口，打开时聚焦以保证点击其他窗口可触发失焦关闭；独立路由会给根节点标记 `data-window="ocr-result"`，CSS 在该模式下让页面、`body` 和 `#app` 透明，由 `.ocr-result-window` 作为窗口页面根容器，`.ocr-result-shell` 直接承载 header、截图预览和文本区，不再套 `.ocr-dialog-backdrop` 或 `.ocr-dialog`，避免透明窗口边缘被内层弹框阴影裁切出深色四角。独立结果窗不展示关闭按钮；header 左侧图钉按钮维护当前窗口会话内的 `pinned` 状态，固定时暂停失焦自动关闭，取消固定后继续遵循设置页的 `ocrResultAutoCloseOnBlur`；header 中的空白区域在鼠标按下时调用 Tauri `startDragging()` 像正常窗口一样移动窗口，右侧只保留重新识别和翻译两个图标按钮，不再提供 OCR 引擎下拉或导出入口，重新识别使用设置页中的 `ocrEngine`。左侧预览会读取图片自然尺寸，把 OCR 返回的 `box` 像素坐标换算成图片显示区域内的百分比叠加框，避免框线相对灰色容器错位。复制文本成功时会在窗口顶部显示轻量绿色胶囊提示。Rust 侧会在窗口存在期间临时注册 `Escape` 关闭窗口，并在窗口销毁时注销；前端在捕获阶段监听 Escape，确保焦点落在 `AppSelect`、文本框等内部控件时仍能关闭窗口；前端还会在 `ocrResultAutoCloseOnBlur` 开启且窗口未固定时监听 `onFocusChanged`，窗口失焦后自动关闭。

Tauri `assetProtocol` 允许默认截图目录 `~/Documents/墨识/**`、旧 OCR 目录 `~/Documents/墨识 OCR/**`、App 数据截图目录、App 数据剪贴板图片目录和临时目录加载为本地图片资源。截图、截图 OCR、OCR 结果窗口和剪贴板图片预览都应优先使用这些受控目录内的文件路径，避免 WebView 因资源协议 scope 不匹配显示破图。

剪贴板历史由 Rust 侧统一管理，数据生产者（NSPasteboard 轮询）在后端，故选用 SQLite 直存而非前端 IndexedDB，避免频繁 IPC。`native_pasteboard.rs` 用独立 OS 线程以 800ms 间隔轮询 `NSPasteboard.changeCount`，变化时调用 Swift helper `moshi-pasteboard-reader` 读取多 UTI，优先级 files > image > text：文件/文件夹只存 NSURL 路径引用不读字节，图片落盘为 PNG 到 App 数据目录后只存路径，文本直接入库。`clipboard_repo.rs` 用 `rusqlite`（bundled，WAL 模式）管理 `~/Library/Application Support/com.local.mac-ocr/clipboard.db`，`Mutex<Connection>` 保证线程安全；`kind` 字段区分 `text`/`image`/`files`/`unknown`，文本按内容去重、文件按 `paths_json` 去重、图片不去重；超过 `max_items` 时裁剪未置顶中的旧记录，置顶（pinned）项不受裁剪影响，更新容量配置时也会立即执行一次裁剪。裁剪和清空历史会删除对应图片文件，配置同步还会扫描 `clipboard-images/` 并清理没有数据库记录引用的孤儿图片缓存。`refresh_expired` 检查文件/图片源是否仍存在并标记失效。敏感内容过滤在轮询侧按 `password`/`token`/`secret` 等关键字跳过，与前端原逻辑一致。轮询入库后 emit `clipboard-changed` 事件，前端 listen 后调 `list_clipboard_history` 刷新；应用内 `write_clipboard_text` 也会同步写入 DB 并触发刷新。`use_clipboard_item` 按历史项类型把文本、PNG 图片或文件/文件夹路径重新写回系统剪贴板，成功后刷新记录时间；失效项不可使用。前端 `ClipboardPage` 按 `kind` 渲染：文本显示截断摘要，图片用 `convertFileSrc` 加载，文件展示文件名列表与图标，失效项灰显提示「源文件已不存在」，统一通过「使用」按钮放回系统剪贴板。轮询开关和容量上限通过 `set_clipboard_polling`、`update_clipboard_config` 命令同步，对应设置页「自动捕获系统复制」和「历史条数上限」。

桌面外层 `.shell` 负责窗口 padding 和纵向高度，页面主内容使用 `width: 100%` 跟随窗口展开；识别页 `.main-workspace` 作为 flex 子项撑满剩余高度，卡片内部通过 `min-height: 0` 把滚动限制在列表或预览内容区。

界面主题由 `ui/src/lib/theme.ts` 统一管理，设置项保存 `system`、`light` 或 `dark` 偏好。选择 `system` 时监听浏览器的 `prefers-color-scheme`，并把解析后的主题写到根节点 `data-theme`；组件样式通过 `ui/src/styles.scss` 中的 CSS 语义变量读取颜色，避免业务组件直接维护深浅色分支。

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
- 新增跨功能的本机缓存统计或清理能力时优先放在 `storage.rs`，前端传入当前 OCR/截图目录，后端负责解析默认目录、按缓存类型统计/清理和错误信息，避免各业务页面重复扫描文件系统。
- 截图、翻译和剪贴板等工具能力优先放在独立领域模块，再通过 `commands.rs` 暴露；翻译新增服务商时在 `translation.rs` 中通过引擎分支封装认证、请求和响应解析，前端只扩展设置 DTO；macOS 截图交互放在 `macos-capture/` Swift helper，Rust 只做进程编排和结果衔接，不塞回 `backend.rs`。
- `macos-capture` helper 的 CLI 参数、`--service` JSONL 请求/响应和 JSON 输出属于 Rust 调用协议；调整时必须同步 `scripts/smoke_macos_capture_helper.sh`，保证非 GUI smoke 能覆盖协议合法、非法参数和 service ready。helper 的 `--self-test-render` 会生成一张标注合成 PNG，用于验证 CoreGraphics 合成链路，不请求屏幕录制权限。
- 普通截图与截图 OCR 的状态不要混在一起：普通截图页负责图片预览和截图工具栏；截图 OCR 不提供主窗口页面，识别结果统一进入独立 OCR 结果窗口。
- 输出文件预览只读取 `txt/json` 等文本产物，列表和预览列只展示输出文件名，不展示完整路径；预览列默认关闭，由用户点击结果行或「预览」打开，预览头部只保留关闭图标；打开和定位由列表行命令调用系统能力完成。
- 新前端通用样式或交互优先沉淀到 `ui/src/components/ui/`；和 OCR、后端、设置等业务强绑定的结构放到 `ui/src/components/features/`。新增或调整下拉选择时统一使用 `AppSelect`，不要在业务组件里直接写原生 `<select>` 或自建弹层列表。
- 新增或调整界面颜色时优先扩展 `ui/src/styles.scss` 的主题变量，保持浅色、深色和跟随系统模式使用同一套组件结构；滚动条颜色继续通过 `--scrollbar-*` 全局变量维护，不在业务选择器里分散覆盖。
- 新确认类交互优先复用 `ui/src/components/ui/useConfirmDialog.tsx` 和 `ConfirmDialog.tsx`，保持应用内系统风格，不直接使用浏览器或系统默认 confirm。
- 新增可被托盘菜单或全局快捷键触发的功能时，先在 `tray.rs` 的 `ACTION_*` 常量和 `dispatch_action` 中加分支，再在 `shortcuts.rs` 的 `ShortcutBindings` 增加字段并补默认值；`entries()` 列表里把功能 ID 与新字段对应起来即可同时覆盖菜单加速器显示、全局快捷键注册和校验。前端 `types.ts`、`lib/settings.ts` 的默认值和 `SettingsPage` 的快捷键分类也要同步，避免设置页缺字段。
- 不把 `.venv/`、`.uv-cache/`、`.paddlex-cache/`、`node_modules/`、`dist/`、`src-tauri/target/` 放进仓库。
