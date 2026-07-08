1. 技术或功能的添加修改要在README.md中修改，和在docs下维护一下关键文档
2. 本应用开发过程中大的功能模块做到解偶，方便复用
3. 前端基础 UI 组件尽量使用 shadcn/ui；项目缺少某个 shadcn 组件时，优先通过官方 CLI 标准命令添加，例如 `pnpm dlx shadcn@latest add button`。shadcn 官方已有的基础组件不要手写同名版本，官方组件文件保持 CLI 默认小写命名。
