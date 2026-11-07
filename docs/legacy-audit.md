# 旧安装包观察与迁移范围

本文是最初搭建骨架时的简要记录。后续已完成模块化逆向梳理，完整技术方案、REA覆盖范围与证据入口见 [文档总索引](README.md)，以下初始记录不代表后续分析状态。

观察来源：`/Users/jiangding/yezi`，版本 `1.0.109`。本记录来自静态 manifest、HTML 入口、中文语言文件和资源检查，不代表已验证运行行为。REA 分析工具在本次会话不可用，未完成对压缩 JS 业务逻辑的逆向分析。

## 已确认的声明

| 旧包证据 | 声明内容 | 新工程处理 |
| --- | --- | --- |
| `manifest.json` | Manifest V3，`background.js` Service Worker | 使用 TypeScript 后台入口 |
| `popup.html`、`options.html` | 独立弹窗、设置页，加载压缩 JS/CSS，页面使用 `root` 挂载点 | 新写 React 页面 |
| `content-scripts/host.js` | manifest 配置全站及所有 frame 注入，排除部分翻译网站 | 骨架仅在 HTTP/HTTPS 顶层页面注入诊断脚本 |
| `_locales/zh_CN/messages.json` | 目标语言、双语/替换显示模式等设置文案 | 先实现目标语言与显示模式存储 |
| `manifest.json` | YouTube 字幕注入、截图快捷键、页面翻译快捷键、登录资源 | 本阶段不迁移 |
| `icon/icon-48.png`、`icon/icon-128.png` | PNG 图标 | 复用，并从 48px 图标生成 16px 图标 |

## 权限与身份

旧包声明 `storage`、`activeTab`、`contextMenus`、`tabs`、`management`、`downloads`、`tts` 及全站 host 权限。

新骨架仅声明 `storage` 和 `activeTab`，并通过静态 content script 的 HTTP/HTTPS 匹配规则访问普通网页。尚未调用外部翻译服务，因此不声明服务域名 host 权限。后续引擎接入时按实际服务补充权限。

没有复制旧包 `key`、`update_url`、商店元数据、登录入口及服务配置。新工程拥有独立扩展身份，不会自动继承旧扩展的本地设置。

## 下一步需要单独梳理的行为

- 旧翻译服务的协议、鉴权和可用性。
- 页面段落提取、请求调度、懒加载与 DOM 还原。
- 双语/替换模式下的布局和富文本保护。
- 动态网页、iframe、快捷键与网站排除规则。
- 视频字幕、截图、划词翻译等附加功能的实际范围。

旧目录保持原样，没有将压缩后的 JS 当作可维护源码移入新工程。
