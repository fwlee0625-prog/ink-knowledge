# Desktop UI Design System

墨识桌面界面采用 `80% shadcn/ui + 20% macOS desktop app` 的方向。整体应接近 Cursor Desktop、Raycast、Vercel Dashboard 和 Linear：克制、专业、留白充足、信息层级清晰，不参考 Apple System Settings，不做 iOS 风格，也不做后台管理系统。

## Foundations

- 组件基础：优先使用 shadcn/ui 结构与 Radix UI 交互能力，项目通过 `components.json` 对齐 shadcn CLI 配置。
- shadcn 添加方式：缺少官方组件时，优先使用官方 CLI 标准命令引入，例如 `pnpm dlx shadcn@latest add button`；初始化或重配时参考 `pnpm dlx shadcn@latest init`。不要为了 shadcn 额外安装或依赖 skills、MCP。
- 当前已通过官方 CLI 引入的组件包括：`button`、`card`、`input`、`switch`、`toggle`、`toggle-group`、`alert`、`separator`、`select` 和 `alert-dialog`。不要再手写同名基础组件；需要项目兼容 API 时，在其上做薄封装。
- 样式基础：使用 Tailwind CSS utility class 和 CSS Variables，不在业务组件中写大量自定义 CSS。
- 图标：统一使用 `lucide-react`，不使用彩色图标；图标颜色默认 `text-foreground`。设置项图标只保留固定 `40x40` 居中占位，不使用独立背景色、圆角底或边框。
- 颜色：遵循 shadcn 默认语义色，业务组件使用 `bg-background`、`text-foreground`、`border-border`、`text-muted-foreground` 等 token。
- Accent：只在 hover、selected 和 primary button 中使用；浅色下接近黑色，深色下接近白色。
- 背景：页面使用 `bg-background`，浅色接近 `#FAFAFA`，深色接近 `#09090B`；禁止渐变和彩色背景。

## Layout

设置页采用经典桌面应用布局：

```text
Settings Toolbar: 不在设置页顶部常驻展示
Sidebar: 176-192px
Main: flex-1
Window padding: 16px
Page gap: 24px
Section gap: 32px
```

Sidebar 可以使用轻微透明与 `backdrop-blur-xl`：

```text
bg-background/70
border-border/50
shadow-sm
```

除此之外，不在页面主体大面积使用毛玻璃，不使用 `blur-3xl`、glow 或装饰性渐变。

## Components

- Card：使用 shadcn Card，`rounded-xl`、`border-border/60`、`shadow-sm`，padding 通常为 `24px`。
- Button：Primary 使用 shadcn default，Secondary 使用 outline，Sidebar 使用 ghost；禁止渐变按钮和发光按钮。
- Input：使用 shadcn Input，圆角 `12px`；搜索能力后续优先放到内容区或命令面板，不在设置页顶部占用一整条 Toolbar。
- Switch：使用 Radix Switch，不自定义二元开关。
- ToggleGroup：用于主题、模式等分段控制，不用多个 Button 伪装；选中项使用 `bg-primary text-primary-foreground`，确保和未选中项有明确视觉区分。
- Alert：底部提示使用 shadcn Alert，`bg-muted/40`，不使用蓝色或黄色提示底。
- SettingItem：设置项统一采用左侧图标、标题、说明，右侧控制区的布局；高度约 `72px`。
- Settings Sidebar：只展示图标和一级名称，不展示副标题，避免菜单占据过多宽度。

## Typography

整页只使用四类字号：

- H1：`text-3xl font-bold`
- H2：`text-xl font-semibold`
- Body：默认正文
- Caption：`text-sm text-muted-foreground`

避免过多粗体，紧凑面板、卡片、侧栏内部不使用 hero 级标题。

## Motion

动画统一 `200ms ease-out`。交互只改变 opacity、background、border、shadow-sm 等轻量属性，不使用 scale、bounce 或复杂动画。

## Spacing And Radius

遵循 8pt grid：`4 / 8 / 12 / 16 / 24 / 32 / 40 / 48`。避免 `13 / 19 / 27` 这类任意值。

圆角约定：

- Card：`16px`
- Input：`12px`
- Button：`10px`
- Dialog：`20px`
- Switch：Radix 默认结构

阴影只使用 `shadow-sm` 或 `shadow-md`，不使用 `shadow-2xl`、glow、neumorphism。

## Implementation Notes

- 新设置项优先复用 `ui/src/components/features/settings/SettingItem.tsx`。
- 新基础组件优先通过 `pnpm dlx shadcn@latest add <component>` 添加到 `ui/src/components/ui/`；官方没有覆盖或需要项目适配时，再按 shadcn/Radix 结构补齐并从 `ui/src/components/ui/index.ts` 导出。
- shadcn 官方组件文件保持 CLI 默认小写命名，例如 `button.tsx`、`select.tsx`；业务兼容封装可以继续使用项目语义命名，例如 `AppButton.tsx`、`AppSelect.tsx`。
- 新颜色先确认是否已有 shadcn 语义 token；确需新增时同时考虑浅色和深色模式。
- 业务页面不直接写原生 `<select>`、自定义 switch 或临时按钮样式；先沉淀组件，再使用组件。
