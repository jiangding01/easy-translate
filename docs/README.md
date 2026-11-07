# 旧插件逆向与重构技术方案索引

目标：把旧插件 `1.0.109` 安装包中可恢复的功能、算法、协议、关键代码和已知缺口整理为可分批实现的依据。**这一阶段只新增文档、证据和分析工具；不实现新翻译功能。**

先读 [架构](modules/00-architecture.md)，按需要进入功能模块，再用 [分批路线图](implementation-roadmap.md) 安排实现。[证据与验证](evidence-and-validation.md) 说明哪些结论是静态观察、哪些做过本地探针、哪些仍未知。

指向 `evidence/` 的链接需要本地证据副本。Git 只跟踪方案文档和分析脚本，获取证据后的目录位置见[项目 README](../README.md#后续迁移)。

## 功能模块索引

| 编号 | 文档 | 可查询的关键内容 |
| --- | --- | --- |
| 00 | [架构、执行入口与消息边界](modules/00-architecture.md) | MV3、四类消息、构建文件责任、存储/缓存/生命周期、新模块边界 |
| 01 | [翻译服务、提示词、调度与缓存](modules/01-translation-providers.md) | Google三级回退、微软签名、DeepLX、OpenAI/DeepSeek/Gemini/custom/AiHubMix/Coco、语言识别、Prompt、令牌桶、IndexedDB |
| 02 | [网页翻译、DOM显示与站点适配](modules/02-page-translation.md) | 自动触发、过滤/分组、HTML占位符、懒加载、双语/混合/替换、还原、iframe/Shadow DOM/SPA、10站点规则 |
| 03 | [划词、悬停、输入、悬浮球与快捷键](modules/03-selection-and-floating-ui.md) | 触发器、选区/光标、输入三连键、竞态、拖拽、TTS、页面键盘与Chrome commands |
| 04 | [截图、译文分享、Markdown与PDF入口](modules/04-screenshot-and-reading.md) | 框选/滚动拼接、水印、图片/ZIP、分享编辑器、缺失本地资源、PDF外跳边界 |
| 05 | [YouTube字幕主链路](modules/05-video-subtitles.md) | fetch/XHR拦截、播放器上下文、轨道/JSON3、时间轴、±10秒翻译窗口、双语覆盖层、设置/下载/SPA |
| 05a | [字幕阅读与文章模式](modules/05a-subtitle-reading.md) | 播放器搬动、逐句翻译、50句分块/2并发文章重写、时间戳对齐、Prompt版本缓存、朗读 |
| 05b | [TikTok字幕与文稿面板](modules/05b-tiktok-captions.md) | host站点处理器、页面数据/HTML fallback、首轨VTT、全量翻译、TXT导出/复制/拖拽 |
| 06 | [弹窗、设置、配置迁移与引导](modules/06-settings-and-configuration.md) | 主配置schema18、完整默认值、迁移表、500ms自动保存、网站/语言规则、连接测试、引导四步 |
| 07 | [账户、OAuth、订阅与业务后端](modules/07-account-and-backend.md) | 微信/Google登录、回调、token/refresh、会员模型分层、短授权码、Coco/文章API与配额错误 |
| 08 | [专家与术语库](modules/08-experts-and-termbase.md) | 六风格、自定义专家CRUD、实际选择来源、术语库/站点匹配、JSON/CSV导入导出、Prompt消费 |
| 09 | [浏览器平台、反馈与遥测](modules/09-browser-platform-and-feedback.md) | 菜单/badge/commands、下载/TTS、冲突扩展管理、反馈数据、Sentry、worker启动与权限 |
| 10 | [国际化、资源与构建边界](modules/10-i18n-and-assets.md) | manifest/UI两套词典、缺词回退与插值、语言代码、注入脚本、缺失资源 |

## 方案与验证索引

| 文档/材料 | 用途 |
| --- | --- |
| [插件整体架构图](architecture-diagrams.md) | 四类执行环境总图、翻译链路、视频阅读、状态存储，以及13模块归属 |
| [分批路线图与验收门槛](implementation-roadmap.md) | 按依赖顺序交付，每批的输入、输出和验收 |
| [插件端覆盖状态](plugin-coverage-status.md) | 区分完整代码留存、功能模块覆盖、逐分支文档与运行验证，避免把它们当成同一完成度 |
| [全面复核报告](audit-report.md) | 本轮逐模块纠正、反例验证、跨文档一致性及剩余边界 |
| [DeepSeek 文档交叉核验](deepseek-cross-validation.md) | 23篇文档对照、有效补充、双方错误、源码裁决与保留材料 |
| [证据方法、覆盖、已知缺口与复查方式](evidence-and-validation.md) | REA Evidence ID、超时与partial覆盖、离线探针、完整性检查、未验证项 |
| [证据目录说明](../evidence/legacy/README.md) | 原始包、可读代码、索引、摘录、工具输出的位置及重现命令 |
| [全文件覆盖映射](../evidence/legacy/artifact-coverage.json) | 53个原文件对应的文档和责任 |
| [默认配置](../evidence/legacy/extracts/platform/default-config.json) | 旧对象字面量的静态提取；未执行旧代码 |
| [schema与枚举](../evidence/legacy/extracts/platform/schemas-and-enums.json) | 精确字段/枚举/边界原表达式 |
| [运行时消息名称](../evidence/legacy/extracts/platform/runtime-message-names.json) | 核心34项type及字面量；动态代理和window bridge另见模块 |
| [站点规则](../evidence/legacy/extracts/page/site-rules.json) | 10站点的完整内置规则、选择器与feature |
| [视频逻辑14项本地探针](../evidence/legacy/extracts/video/probe-results.json) | 实际执行旧包抽取函数，包含旧缺陷复现 |
| [文档与证据校验结果](../evidence/legacy/validation-report.json) | 原始/排版hash、代码摘录、相对链接、文件覆盖的交付检查 |
| [最初骨架观察](legacy-audit.md) | 历史起点；完整结论以本索引下文档为准 |

## 阅读约定

每个模块包含旧入口、调用/数据链路、存储与消息、关键原代码、异常边界、重构建议、验收和未知项。代码摘录保留压缩符号；文中语义名称和 TypeScript 说明类型是分析命名，不是恢复的原作者名称。

源码链接 `#L数字` 表示**冻结排版文件中的 LF 行号**，原始字节以 inventory 的 SHA-256 为准。第三方SDK/框架的未调用API不计入产品功能；配置字段存在也不自动算作已生效。

## 影响重构范围的主要结论

- 截图实现是框选、滚动拼接和导出，未发现该链路的OCR；PDF入口跳到在线站点。
- 百度/有道出现在配置枚举中，实际服务派发未实现；DeepLX默认URL与拼接方式存在矛盾。
- requestQueue 是令牌桶，maxConcurrent并非严格并发上限；旧缓存不在读取时严格检查TTL，部分Prompt/上下文变化未进入缓存键。
- 字幕有YouTube和TikTok两条独立实现；Netflix等检测分支不能当作完整支持。
- 已复现字幕重试Promise悬挂、部分VTT边界；多个设置仅存在配置或UI，不能默认其已生效。
- `vditor/dist/**` 在manifest声明但文件缺失；分享编辑器的历史运行完整性未知。
- 账户和收费依赖服务端。安装包可恢复客户端契约，不能恢复服务端鉴权、计费或模型路由实现。

这些结论是迁移决策依据，不表示本次已经修复旧代码或迁移到新工程。
