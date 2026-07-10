# 应用更新检测与发布

## 目标与边界

墨识使用公开 GitHub Releases 存放 DMG，并通过 GitHub REST API 获取最新正式版本。应用不需要独立后端，也不会在首版中自动安装更新。

完整历史更新日志随前端构建产物发布；GitHub 只负责当前最新版信息和安装包。这样旧版本每次检查只请求一个 `releases/latest` 接口，新版本安装后即可看到截至该版本的全部历史记录。

## 运行时流程

Rust `update` 模块从 `release/config.json` 读取 `owner/repo`，构建环境可用 `MOSHI_GITHUB_REPOSITORY` 覆盖。应用进程启动后异步执行一次检查，后续窗口只读取进程内缓存；用户点击「检查更新」时重新请求：

```text
GET https://api.github.com/repos/{owner}/{repo}/releases/latest
  -> 校验 HTTP、响应大小和 JSON
  -> 要求 tag_name 为 vMAJOR.MINOR.PATCH
  -> 与 Tauri package version 做 SemVer 比较
  -> 选择第一个 .dmg asset
  -> 缓存状态并发送 app-update-status-changed
```

`get_app_update_status` 只读缓存，`check_app_update` 发起检查。并发检查会合并，防止启动检查和手动检查重复请求。请求沿用项目现有的 macOS 系统 `curl` 调用方式，使用 5 秒连接超时、10 秒总超时和 256 KB 响应上限；403/429 作为 GitHub 限流处理，404 表示仓库配置错误或没有正式 Release。

只有 HTTPS GitHub 发布域名会进入状态结果。设置窗口的 opener 权限进一步限制为 `github.com`、`objects.githubusercontent.com` 和 `release-assets.githubusercontent.com`。Release 有 DMG 时直接打开下载地址，否则打开 `html_url`。

## 更新日志

`ui/src/data/changelog.json` 是历史日志的唯一内容来源，最新版本必须放在数组第一项：

```json
{
  "version": "0.2.0",
  "date": "2026-07-10",
  "title": "版本标题",
  "changes": ["新增功能", "问题修复"]
}
```

前端按版本倒序展示并标记当前安装版本。远端 Release body 只作为“发现新版本”时的最新版摘要，按纯文本展示，不解析 HTML。

## 发布步骤

1. 创建公开 GitHub 仓库，并在 `release/config.json` 填写 `owner/repo`。
2. 在 `changelog.json` 顶部添加新版本记录。
3. 运行 `pnpm release:prepare -- <version>`，同步三处应用版本并生成 `release/release-notes.md`。
4. 运行 `zsh scripts/verify_desktop_release.sh` 完成非 GUI 发布验证和打包。
5. 使用 `gh release create v<version> <dmg>` 创建正式 Release 并上传 DMG；不要加 `--prerelease`。

GitHub `releases/latest` 会自动忽略草稿和预发布版本。若以后需要测试渠道，应新增显式更新通道，不改变稳定通道的标签语义。

## 后续自动安装

当前下载按钮交给系统浏览器处理。若后续接入 Tauri Updater，可继续复用本地更新日志和发布准备脚本，但需要为更新产物增加签名、平台清单、下载校验、安装失败恢复和重启确认；在这些条件齐备前不应直接执行应用内安装。
