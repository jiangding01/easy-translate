# Easy Translate

Easy Translate 是面向 Chrome 的网页翻译扩展，围绕网页双语阅读、划词翻译、输入翻译和视频字幕设计，使用 TypeScript、React、WXT 与 Manifest V3 开发。

项目当前版本为 `0.1.0`，处于基础工程阶段。已完成弹窗、设置页、后台 Service Worker、页面通信和本地偏好存储。翻译引擎及各业务模块将按技术方案分批接入。

## 当前功能

- 在弹窗中检查当前网页，显示页面标题、HTML 声明的语言及通信状态。
- 在设置页保存目标语言和双语对照／替换原文的显示偏好。
- 在受限页面或页面脚本连接失败时显示操作提示。

## 规划模块

| 模块 | 规划能力 |
| --- | --- |
| 网页翻译 | 文本提取、双语／替换／混合显示、动态内容、站点适配和原文恢复 |
| 页面交互 | 划词、悬停、输入翻译、悬浮球与快捷键 |
| 翻译服务 | 多供应商适配、请求调度、取消、缓存、自定义提示词和术语库 |
| 视频与阅读 | YouTube 字幕、字幕阅读与文章模式、TikTok 文稿 |
| 截图与分享 | 选区截图、长图拼接、Markdown 编辑和图片导出 |
| 配置与平台 | 设置引导、国际化、浏览器朗读、下载及可选账户服务 |

各模块的接口、关键逻辑、实施顺序和验收条件见[技术方案设计](docs/design/README.md)。

## 开发环境

- Node.js 22.12 或更新版本，推荐使用 `.nvmrc` 指定的 Node.js 24。
- npm，项目 `.npmrc` 固定使用官方源 `https://registry.npmjs.org/`。
- Chrome，启用扩展开发者模式。

## 快速开始

```sh
nvm use
npm ci
npm run dev
```

使用其他 Node.js 管理工具时，确认版本满足要求后执行 npm 命令。

打开 `chrome://extensions`，启用「开发者模式」，点击「加载已解压的扩展程序」，选择 `.output/chrome-mv3-dev`。

WXT 会监听源码并更新开发产物。修改 manifest 或后台逻辑后，可在扩展管理页重新加载扩展，并刷新用于调试的网页。

## 构建与检查

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Chrome 扩展开发构建 |
| `npm run typecheck` | 执行 TypeScript 严格检查 |
| `npm run check` | 执行类型检查、生产构建和 manifest 入口资源校验 |
| `npm run build` | 生成 `.output/chrome-mv3` 生产产物 |
| `npm run zip` | 在 `.output` 中生成扩展 ZIP 包 |

本地验证生产版本时，在扩展管理页加载 `.output/chrome-mv3`。

## 项目结构

```text
src/
  entrypoints/
    background.ts       # 后台 Service Worker
    content.ts          # 网页内容脚本
    popup/              # 工具栏弹窗
    options/            # 设置页
  components/           # 共享界面组件
  lib/                  # 消息协议、设置模型与存储
  styles/               # CSS Modules 样式
public/icon/            # 扩展图标
scripts/check-build.mjs # 构建产物校验
docs/design/            # 分模块技术方案与验收计划
DESIGN.md               # 界面设计与组件规范
wxt.config.ts           # WXT 与 Manifest V3 配置
```

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [文档中心](docs/README.md) | 按功能查阅设计文档 |
| [技术方案总入口](docs/design/README.md) | 完整的模块索引及阅读顺序 |
| [整体架构](docs/design/00-architecture.md) | 执行环境、模块职责和架构图 |
| [通信与数据契约](docs/design/13-protocols-and-data.md) | 消息、任务会话、配置和缓存契约 |
| [实施与验收计划](docs/design/14-implementation-and-validation.md) | 开发批次、依赖和完成门槛 |
| [界面规范](DESIGN.md) | 视觉、组件、布局和交互约定 |

## 本地验收

1. 加载扩展，在普通 HTTP/HTTPS 页面打开弹窗。
2. 点击「检查当前页面」，确认显示页面标题和声明语言。
3. 打开「翻译设置」，修改并保存偏好，重新打开弹窗确认持久化。
4. 在 Chrome 内部页等受限页面验证错误提示。
5. 在扩展管理页检查 Service Worker 和弹窗的运行错误。

安装或重新加载扩展后，请刷新已有网页，使内容脚本生效。Chrome 内部页、网上应用店和内置 PDF 阅读器等页面受浏览器注入限制。

## 开发约定

配置密钥通过对应服务的设置流程管理，避免写入源码、静态资源、日志和版本库。新增功能按方案划分责任，并同时覆盖失败、取消和资源清理路径。
