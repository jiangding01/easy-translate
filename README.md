# Easy Translate

Easy Translate 是面向 Chrome 的网页翻译扩展，围绕网页双语阅读、划词翻译、输入翻译和视频字幕设计，使用 TypeScript、React、WXT 与 Manifest V3 开发。

项目当前版本为 `0.1.0`，已完成 M0 地基和 M1 翻译核心：后台可以调用 Google、OpenAI、DeepSeek、Gemini 和最多 10 个自定义的 OpenAI 兼容服务（含本地模型），带调度、超时、退避、缓存与密钥管理；设置页可以配置并测试这些服务。网页上的翻译入口从 M2（整页翻译）开始接入。

## 当前功能

- **设置页 · 翻译服务**：选择默认引擎；为 OpenAI、DeepSeek、Gemini 填写密钥和模型；添加最多 10 个自定义服务（Ollama、LM Studio、OpenRouter、硅基流动等预设，或任意 OpenAI 兼容地址），添加时申请访问权限；每个服务都能用「Hello, world.」测试连接；查看和清空翻译缓存。密钥只保存在本机，页面只能看到末 4 位。
- **设置页 · 通用**：目标语言、源语言（默认自动检测）、外观（跟随系统／浅色／深色），选择即保存。
- **工具栏面板**：显示当前网站和页面语言，切换目标语言和默认引擎；母语页面、浏览器页面、需要刷新的页面各有安静的提示；默认引擎缺密钥或未授权时给出「去设置」。「翻译此页」在 M2 接入。
- 界面使用「隐中生岛」方向的琥珀主题，亮暗两套，下拉选择为自研组件。

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
| `npm run lint` | Biome 只读检查（格式与 lint），即 `biome ci .` |
| `npm run format` | Biome 自动格式化并应用安全修复 |
| `npm run typecheck` | 执行 TypeScript 严格检查 |
| `npm test` | 运行 Vitest 单元测试；`npm run test:watch` 为监听模式 |
| `npm run build` | 生成 `.output/chrome-mv3` 生产产物 |
| `npm run check:build` | 校验 manifest 及其引用的入口资源 |
| `npm run check:contrast` | 校验颜色 token 的对比度（文字 ≥ 4.5:1，控件与焦点环 ≥ 3:1，亮暗各一套） |
| `npm run check:size` | 按入口检查 gzip 体积预算（content ≤ 20KB、background ≤ 60KB、popup ≤ 90KB、options ≤ 150KB） |
| `npm run check` | 依次执行 lint、typecheck、check:contrast、test、build、check:build、check:size |
| `npm run zip` | 在 `.output` 中生成扩展 ZIP 包 |

GitHub Actions（`.github/workflows/ci.yml`）在 PR 和推送到 `main` 时运行同一套检查。本地验证生产版本时，在扩展管理页加载 `.output/chrome-mv3`。

## 项目结构

```text
src/
  entrypoints/
    background.ts       # 后台 Service Worker：配置唯一写入点、翻译服务、消息与 Port handler
    content.ts          # 网页内容脚本
    popup/              # 工具栏面板
    options/            # 设置页（通用、翻译服务、添加服务对话框、连接测试）
  components/           # 共享界面组件（自研下拉 Select）
  lib/
    config/             # 配置：schema、宽松解析、仓库（后台）、客户端与 useConfig（页面）、引擎字段映射
    messaging/          # 类型化消息协议、handle/call、Port 传输层、发送方校验
    translate/          # 翻译核心（只在后台使用）：provider、调度器、缓存、密钥、权限
    engine-view.ts      # 引擎列表与就绪判断（设置页和面板共用）
    endpoint.ts         # 接口地址规整与主机权限判断（页面和后台共用）
    host-permission.ts  # 页面侧的可选主机权限 hook
    errors.ts           # AppError 与 Result
    error-messages.ts   # 错误码到中文文案
    languages.ts        # 支持的语言与语言标签归一化
  styles/
    tokens.css          # 设计 token（唯一来源，:root 与 :host；琥珀主题）
    base.css            # 扩展页面的全局基础样式
    theme.ts            # 主题切换（data-et-theme）
public/icon/            # 扩展图标
scripts/
  check-build.mjs       # manifest 与入口资源校验
  check-size.mjs        # gzip 体积预算（零依赖）
  check-contrast.mjs    # 颜色 token 对比度校验（零依赖）
.github/workflows/      # CI
docs/plans/             # 各批次技术方案
docs/design/            # 旧方案（功能参考）
biome.json              # Biome 配置
vitest.config.ts        # Vitest 配置（WxtVitest + fake browser）
wxt.config.ts           # WXT 与 Manifest V3 配置
```

单元测试与源码同目录放置，命名为 `*.test.ts`。

## 文档导航

| 文档 | 内容 |
| --- | --- |
| [交接文档](HANDOFF.md) | 当前进度、已拍板决策和下一步，**接手开发先读这里** |
| [最终技术方案](docs/reviews/2026-11-13-final-plan.md) | 权威架构、选型和 M0–M8 交付批次 |
| [UI/UX 设计规范](docs/reviews/2026-11-13-ui-ux-design.md) | 权威视觉、交互和性能预算 |
| [更新日志](CHANGELOG.md) | 功能迭代记录 |
| [文档中心](docs/README.md) | 按功能查阅设计文档 |
| [技术方案总入口](docs/design/README.md) | 完整的模块索引及阅读顺序 |
| [整体架构](docs/design/00-architecture.md) | 执行环境、模块职责和架构图 |
| [通信与数据契约](docs/design/13-protocols-and-data.md) | 消息、任务会话、配置和缓存契约 |
| [实施与验收计划](docs/design/14-implementation-and-validation.md) | 开发批次、依赖和完成门槛 |
| [M0 地基方案](docs/plans/m0-foundation.md) | 质量门禁、配置、消息、Port 与设计 token 的实现依据 |
| [M1 翻译核心方案](docs/plans/m1-translation-core.md) | provider、调度、缓存、密钥、权限与设置页的实现依据 |
| [界面方向：隐中生岛](docs/plans/ui-isle-direction.md) | 已确认的界面方向、动效规范与琥珀主题 token |

## 本地验收

1. 加载扩展，打开设置页的「翻译服务」，默认引擎为 Google，点「测试连接」应显示译文和延迟。
2. 为 OpenAI、DeepSeek 或 Gemini 填写自己的密钥（Gemini 还要填写模型），测试连接成功；填错密钥时提示「密钥无效」类错误。
3. 点「添加服务」，选一个预设（例如 Ollama），填写模型后添加：浏览器弹出授权请求；允许后新服务出现在「自定义」分组并自动测试一次；拒绝时标为「待授权」，可在详情里重新授权。
4. 删除一个设为默认的自定义服务，默认引擎自动改回 Google。
5. 在「通用」页用下拉切换目标语言和源语言，用键盘（方向键、回车、Esc、首字母）操作下拉；切换外观为深色。
6. 在普通网页打开工具栏面板，确认显示网站和页面语言，能切换目标语言和默认引擎；在中文页面、`chrome://extensions` 和安装前已打开的网页上，分别显示对应提示。
7. 清空翻译缓存后，条数归零。
8. 在 `chrome://serviceworker-internals` 停止 Service Worker 后再修改设置或测试连接，确认仍能正常工作。

安装或重新加载扩展后，请刷新已有网页，使内容脚本生效。Chrome 内部页、网上应用店和内置 PDF 阅读器等页面受浏览器注入限制。

## 开发约定

配置密钥通过对应服务的设置流程管理，避免写入源码、静态资源、日志和版本库。新增功能按方案划分责任，并同时覆盖失败、取消和资源清理路径。
