# Easy Translate

Easy Translate 是面向 Chrome 的网页翻译扩展，围绕网页双语阅读、划词翻译、输入翻译和视频字幕设计，使用 TypeScript、React、WXT 与 Manifest V3 开发。

项目当前版本为 `0.1.0`，已完成 M0 地基、M1 翻译核心、M2 整页翻译与灵岛、M3a 划词翻译：网页可以一键双语阅读，选中文字即可在卡片里翻译（英文单词带 UK/US 音标）；后台可以调用 Google、OpenAI、DeepSeek、Gemini 和最多 10 个自定义的 OpenAI 兼容服务（含本地模型），带调度、超时、退避、缓存与密钥管理。

## 当前功能

- **整页翻译**：点工具栏面板的「翻译此页」，或按快捷键（macOS `⌃⇧A`，Windows/Linux `Alt+A`）。译文出现在原文下方，沿用网页自己的字体；先翻眼前的段落，往下读时继续。面板里可以切换「双语 / 仅译文」、重试没译出的段落、「显示原文」还原网页，以及打开「总是翻译此站」。快捷键可以在 `chrome://extensions/shortcuts` 修改。
- **划词翻译**：选中网页上的外文，选区末尾出现琥珀小点，点击（或停留片刻）长出翻译卡片，可切换引擎、折叠原文、复制、固定并拖动；也可用右键菜单「翻译选中文字」或快捷键（macOS `⌃⇧S`，Windows/Linux `Alt+Shift+S`）。AI 引擎的译文边生成边显示；选中单个英文单词时显示 UK / US 音标（离线词表，约 17.5 万 / 11.7 万词），点击按对应口音朗读；朗读使用系统自带语音。
- **设置页 · 翻译服务**：选择默认引擎；为 OpenAI、DeepSeek、Gemini 填写密钥和模型；添加最多 10 个自定义服务（Ollama、LM Studio、OpenRouter、硅基流动等预设，或任意 OpenAI 兼容地址），添加时申请访问权限；每个服务都能用「Hello, world.」测试连接；查看和清空翻译缓存。密钥只保存在本机，页面只能看到末 4 位。
- **设置页 · 通用**：目标语言、源语言（默认自动检测）、外观（跟随系统／浅色／深色）、译文样式（无装饰／淡化／下划线／高亮，带预览）和打开时的显示方式，选择即保存。
- **工具栏面板**：显示当前网站和页面语言，切换目标语言和默认引擎（引擎带供应商图标），右下角「设置」进入设置页；母语页面、浏览器页面、需要刷新的页面各有安静的提示；默认引擎缺密钥或未授权时给出「去设置」。
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
| `npm run typecheck` | 先 `wxt prepare` 生成类型（含界面文案键），再执行 TypeScript 严格检查 |
| `npm run check:i18n` | 校验界面文案：各语言文件键与占位符一致；源码不得新增或改写中文硬编码（尚未迁移的以文本哈希记在 `scripts/i18n-baseline.json`，只减不增，迁移后用 `-- --update-baseline` 收缩） |
| `npm test` | 运行 Vitest 单元测试；`npm run test:watch` 为监听模式 |
| `npm run build` | 生成 `.output/chrome-mv3` 生产产物 |
| `npm run check:build` | 校验 manifest 及其引用的入口资源，以及 `_locales` 与 manifest 中的 `__MSG_*__` 文案 |
| `npm run check:contrast` | 校验颜色 token 的对比度（文字 ≥ 4.5:1，控件与焦点环 ≥ 3:1，亮暗各一套） |
| `npm run check:size` | 按入口检查 gzip 体积预算（content ≤ 7KB、page-runtime ≤ 24KB、selection-runtime ≤ 19KB、background ≤ 60KB、popup ≤ 90KB、options ≤ 150KB） |
| `npm run check` | 依次执行 lint、typecheck、check:i18n、check:contrast、test、build、check:build、check:size |
| `npm run zip` | 在 `.output` 中生成扩展 ZIP 包 |

GitHub Actions（`.github/workflows/ci.yml`）在 PR 和推送到 `main` 时运行同一套检查，另外还做三件事：

- 依赖审计：运行时依赖有高危漏洞时拦截；开发依赖的漏洞只报告，不拦截；PR 新增或升级的依赖由 dependency review 检查，有高危漏洞时拦截。
- CodeQL 安全扫描（`.github/workflows/codeql.yml`）：PR、推送到 `main` 时运行，另外每周一运行一次，使用 `security-extended` 规则集。
- 校验依赖包的仓库签名。
- 全部检查通过后，上传构建好的扩展。

**下载验收包**：打开 PR 的 Checks，进入这次 CI 运行的 Summary 页，在 Artifacts 里下载 `easy-translate-chrome-<提交号>`（保留 7 天），解压后在扩展管理页「加载已解压的扩展程序」。本地验证生产版本时，加载 `.output/chrome-mv3`。

依赖更新由 Dependabot 每周检查（`.github/dependabot.yml`），npm 和 GitHub Actions 的小版本、补丁更新分组提 PR。

## 项目结构

```text
src/
  entrypoints/
    background.ts       # 后台 Service Worker：配置唯一写入点、翻译服务、消息与 Port handler
    content.ts          # 网页内容脚本（首屏引导，约 7KB）：收消息、站点记忆自动翻译、按需加载 page-runtime
    page-runtime.ts     # 按需模块：唤起后由内容脚本 import()，装配整页翻译会话（动态 URL 的 web accessible resource）
    selection-runtime.ts # 按需模块：首次划词时加载，装配划词卡片
    popup/              # 工具栏面板
    options/            # 设置页（通用、翻译服务、添加服务对话框、连接测试）
  content/              # 整页翻译（内容脚本侧）：引导与加载器、扫描与分段、视口队列与会话、渲染与动效、还原、动态内容
    isle/               # 灵岛：弹簧、外形几何、悬停意图、碰撞与亮暗探测、Shadow DOM 宿主
    selection/          # 划词：选区观察（常驻）、可见文字提取、卡片定位、请求与丢弃规则、朗读（含卡死兜底）、卡片
    svg-icon.ts         # 卡片与灵岛共用的引擎图标绘制
    i18n.ts             # 按需模块取界面文案（getMessage 的类型化封装，含复数选择）
  locales/              # 界面文案 en.yml（默认）、zh_CN.yml；构建时生成 _locales 与类型（@wxt-dev/i18n）
  components/           # 共享界面组件（自研下拉 Select、供应商图标 ProviderIcon）
  lib/
    config/             # 配置：schema、宽松解析、仓库（后台）、客户端与 useConfig（页面）、引擎字段映射
    messaging/          # 类型化消息协议、handle/call、Port 传输层、发送方校验
    translate/          # 翻译核心（只在后台使用）：provider、调度器、缓存、密钥、权限、原样回显检测
    phonetic/           # 英文音标：写法转换、分片查找、变形推导、英美拼写互查（后台）
    provider-icons.ts   # 供应商图标的路径数据（lobe-icons，MIT）
    engine-view.ts      # 引擎列表与就绪判断（设置页和面板共用）
    endpoint.ts         # 接口地址规整与主机权限判断（页面和后台共用）
    host-permission.ts  # 页面侧的可选主机权限 hook
    errors.ts           # AppError 与 Result
    error-messages.ts   # 错误码到中文文案
    languages.ts        # 支持的语言与语言标签归一化
    ui-locale.ts        # 界面文案的实际语言（meta.locale），扩展页面的 <html lang>
    site-memory.ts      # 「总是翻译此站」的存储格式与写入（只由后台写）
    action-icon.ts      # 工具栏图标的状态小点
  styles/
    tokens.css          # 设计 token（唯一来源，:root 与 :host；琥珀主题）
    tokens-isle.css     # 灵岛用到的 token（由 tokens.css 引入，按需模块单独内联）
    base.css            # 扩展页面的全局基础样式
    theme.ts            # 主题切换（data-et-theme）
public/icon/            # 扩展图标
public/dict/            # 音标分片 gb/、us/，来源 SOURCES.txt 与许可文件（由 scripts/build-phonetics.mjs 生成）
scripts/
  check-build.mjs       # manifest 与入口资源校验；按需模块单文件、严格模式可执行、不含扩展地址
  check-size.mjs        # gzip 体积预算（零依赖）
  check-contrast.mjs    # 颜色 token 对比度校验（零依赖）
  check-i18n.mjs        # 界面文案校验：语言文件一致性、中文硬编码基线（i18n-baseline.json）
  i18n-messages.mjs     # 读取语言文件、模拟 Chrome getMessage（check-i18n 与单测共用）
  build-phonetics.mjs   # 从 ECDICT 与 ipa-dict 生成音标分片（手动运行，不在构建里）
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
| [M2 整页翻译方案](docs/plans/m2-page-translation.md) | 扫描分段、视口队列、渲染与验收清单 |
| [M2b 按需加载与灵岛](docs/plans/m2b-lazy-runtime-and-isle.md) | 首屏瘦身、按需模块与灵岛 |
| [M3a 划词翻译方案](docs/plans/m3a-selection.md) | 小点与卡片、流式、选区一致性、真机调整 |
| [引擎供应商图标](docs/plans/provider-icons.md) | 图标数据、下发方式与体积 |
| [英文单词音标](docs/plans/phonetics-en.md) | 数据来源、写法转换、分片、朗读卡死修复 |
| [页面 DOM 约定（对外）](docs/dom-contract.md) | 译文插进网页后留下的标记，供网页导出等第三方工具读取；修改属于不兼容变更 |
| [Codex 复核核实](docs/reviews/2026-11-17-core-findings-verification.md) | 核心实现问题的核实结论与修复排期 |

## 接入本地 Ollama

1. 在设置页「翻译服务」点「添加服务」，选「Ollama（本地）」，在「模型」里填 `ollama list` 显示的模型名（例如 `qwen2.5:7b`），点「添加」并在浏览器的授权提示里选「允许」。
2. Ollama 默认拒绝来自浏览器扩展的请求，测试连接会提示「本地服务拒绝了扩展的请求」。在终端运行下面的命令，然后**从菜单栏彻底退出 Ollama 再重新打开**（只关窗口不会重启后台服务）：

   ```bash
   launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
   ```

   用 `ollama serve` 启动的，改成 `OLLAMA_ORIGINS="chrome-extension://*" ollama serve`。可用 `ps -o lstart,command -p $(pgrep -f "ollama serve")` 确认服务确实是刚启动的。
3. 不需要打开 Ollama 设置里的「Expose Ollama to the network」：扩展访问的是本机地址，打开它只会把服务暴露给局域网。
4. 速度：模型第一次加载较慢，可能超时，等加载完再测一次即可。翻译用不到很长的上下文，把 Ollama 设置里的 Context length 调到 8k–16k 能明显加快加载和响应；整页翻译更适合 7B–8B 的模型。

## 本地验收

1. 加载扩展，打开设置页的「翻译服务」，默认引擎为 Google，点「测试连接」应显示译文和延迟。
2. 为 OpenAI、DeepSeek 或 Gemini 填写自己的密钥（Gemini 还要填写模型），测试连接成功；填错密钥时提示「密钥无效」类错误。
3. 点「添加服务」，选一个预设（例如 Ollama），填写模型后添加：浏览器弹出授权请求；允许后新服务出现在「自定义」分组并自动测试一次；拒绝时标为「待授权」，可在详情里重新授权。
4. 删除一个设为默认的自定义服务，默认引擎自动改回 Google。
5. 在「通用」页用下拉切换目标语言和源语言，用键盘（方向键、回车、Esc、首字母）操作下拉；切换外观为深色。
6. 在普通网页打开工具栏面板，确认显示网站和页面语言，能切换目标语言和默认引擎；在中文页面、`chrome://extensions` 和安装前已打开的网页上，分别显示对应提示。
7. 清空翻译缓存后，条数归零。
8. 在 `chrome://serviceworker-internals` 停止 Service Worker 后再修改设置或测试连接，确认仍能正常工作。
9. 整页翻译的完整验收清单（含 4 倍 CPU 降速下的动效检查）见 [`docs/plans/m2-page-translation.md`](docs/plans/m2-page-translation.md) 第 10 节。
10. 「只看译文」的版面：运行 `python3 -m http.server 8765 --directory tests/fixtures`，打开 `http://localhost:8765/translation-only-layout.html`（内容脚本只在 http/https 页面运行，不能直接打开文件），翻译整页、切到只看译文、拖动窗口宽度，按每个用例下方的灰色说明核对，再切回双语确认原样恢复。

安装或重新加载扩展后，请刷新已有网页，使内容脚本生效。Chrome 内部页、网上应用店和内置 PDF 阅读器等页面受浏览器注入限制。

## 开发约定

配置密钥通过对应服务的设置流程管理，避免写入源码、静态资源、日志和版本库。新增功能按方案划分责任，并同时覆盖失败、取消和资源清理路径。

## 安全

发现安全问题时，请不要公开提 issue，在仓库 Security 页点「Report a vulnerability」私下报告，详见 [SECURITY.md](SECURITY.md)。

## 许可证与第三方资源

本项目以 [MIT 许可证](LICENSE) 开源。

扩展中包含以下第三方资源，各自沿用原许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)（扩展包里另有一份 `THIRD_PARTY_NOTICES.txt`）：

- 供应商图标：[lobe-icons](https://github.com/lobehub/lobe-icons)（MIT）
- 面板设置齿轮：[Tabler Icons](https://github.com/tabler/tabler-icons)（MIT）
- 英音音标：[ECDICT](https://github.com/skywind3000/ECDICT)（MIT）
- 美音音标：[ipa-dict](https://github.com/open-dict-data/ipa-dict)（MIT），基于 [cmudict-ipa](https://github.com/lingz/cmudict-ipa)（MIT）和 [CMU Pronouncing Dictionary](https://github.com/cmusphinx/cmudict)（BSD 类许可）
