# 与 DeepSeek 文档的交叉核验

结论：两版主体功能范围一致，但各有遗漏、错误和过度概括。DeepSeek 的详细材料补出了若干重要控制流；也有我方已有反例能推翻的结论，另有双方共同误读。已将源码支持的补充合入模块文档，保留不同意见及裁决依据。此次没有实现新插件功能。

## 1. 比较基线与方法

对照 `/Users/jiangding/yezi/docs` 的23篇 Markdown，以及其引用的analysis材料。原文和分析共92个文件复制留存在 [DeepSeek快照](../evidence/legacy/cross-validation/deepseek-manifest.json)，未修改原目录或快照内容。比较开始前的我方文档保存在 `evidence/legacy/cross-validation/baseline/docs`。

重新核验旧包53个文件与我方原始快照的SHA-256，全部相同；92个复制文件的hash亦全部通过，见 [source-check.json](../evidence/legacy/cross-validation/source-check.json)。两边读取的是同一版本安装包。DeepSeek 的39文件分析清单与我方53文件原始清单口径不同；Prettier和TypeScript排版行数不同，也不代表代码或功能更多。

逐模块对照后，回查冻结源码的函数、调用者及错误分支裁决。服务、页面、视频、UI由GPT-6.1 Terra分工检查，主代理负责交叉问题、平台/国际化、证据验收和汇总。没有将任一文档当成事实来源，也没有逐条重新运行所有行为。

## 2. 确认的有效补充和我方修正

| 模块 | 核实后的内容 | 合入位置 |
| --- | --- | --- |
| Google回退 | 页面后台代理的网络失败被包装为status=0，不满足回退条件；后台直接fetch抛无status错误是不同路径 | [01](modules/01-translation-providers.md) |
| Prompt/缓存 | 自定义fallback模板的术语/上下文注入依赖固定首句正则；缓存初始化失败后同实例不重新初始化 | [01](modules/01-translation-providers.md) |
| 网页/站点 | 远程规则替换不更新已捕获的handler对象引用；X/Twitter/GitHub跳过通用SPA监听；语言检测有汉字导致日文误判的边界 | [02](modules/02-page-translation.md) |
| 交互 | 补悬停清理与输入翻译初始禁用后热启用的限制 | [03](modules/03-selection-and-floating-ui.md) |
| 账户/字幕文章 | nullish与空字符串token合并不同；字幕页面重试、登录例外、异常立即回退须分开 | [07](modules/07-account-and-backend.md)、[05a](modules/05a-subtitle-reading.md) |
| UI | 专家卡的选择只改组件state；popup和引导的实际保存、切换及预览竞态需按路径限定 | [06](modules/06-settings-and-configuration.md) |
| 反馈 | 错误通知的一键上报复用配置收集链路；补准确初始化位置和调试输出边界 | [09](modules/09-browser-platform-and-feedback.md) |
| 国际化 | 新增两套词典、缺词与语言回退、插值、资源缺失和构建边界模块 | [10](modules/10-i18n-and-assets.md) |

双方还共同写错了YouTube内置规则：过滤函数存在，但被过滤字符串并不在当前fallback的forceBlock中，因此这次过滤实际为空操作。[02](modules/02-page-translation.md)已更正。

## 3. 对方需要修正或限定的主要结论

- 令牌桶capacity不等于严格在飞并发上限；Coco累计重试不是“整个Service Worker生命周期同一tick的三次重试”。
- YouTube不是无条件ASR优先；需要先按非CC组/全部轨道分组。普通逐句缓存与文章模式缓存键不同，JSON3主解析与fallback也不能合并描述。
- 关闭划词面板后，React effect可以调用后台TTS_STOP；不能只看hide函数认定后台语音必不停。字幕阅读专用路径缺TTS调用，不等于整个host没有其他语音代码。
- iframe有自己的管理器；懒加载completed不保证所有未来可见内容译完；框架提供清理API不证明所有业务监听都注册了清理。
- 共享国际化helper在现有语言缺key时直接显示key，不再查中文；`P`的点分查找是嵌套寻址。反馈脚本是手写DOM，不是独立React根。
- 资源缺失不能证明已内联或只是历史声明；系统语言不是每次热读都重算；刷新失败也不是每个分支都清登录态。

逐项原说法、章节位置与冻结源码LF见下方记录。未确认项包括远程规则返回体、固定密钥的历史来源、旧服务现状、部分字段的全包无消费断言及真实站点行为；没有据此直接删配置或恢复服务端实现。

## 4. 23篇文档映射与详细裁决

| DeepSeek文档 | 我方模块 | 核验记录 |
| --- | --- | --- |
| 00架构、01消息、02配置 | 00/06/09 | [平台记录](../evidence/legacy/cross-validation/platform-comparison.md)、[页面记录](../evidence/legacy/cross-validation/page-comparison.md) |
| 03翻译核心、04供应商、05专家术语 | 01/08 | [服务记录](../evidence/legacy/cross-validation/services-comparison.md) |
| 06网页引擎、07渲染、08交互、09站点 | 02/03/04 | [页面记录](../evidence/legacy/cross-validation/page-comparison.md) |
| 10视频字幕 | 05/05a/05b | [视频记录](../evidence/legacy/cross-validation/video-comparison.md) |
| 11popup、12options、13引导 | 06/08 | [UI记录](../evidence/legacy/cross-validation/ui-comparison.md) |
| 14登录、15账户API | 07/09 | [服务记录](../evidence/legacy/cross-validation/services-comparison.md)、[平台记录](../evidence/legacy/cross-validation/platform-comparison.md) |
| 16阅读/截图/TTS | 03/04/05a/09 | [视频记录](../evidence/legacy/cross-validation/video-comparison.md)、[页面记录](../evidence/legacy/cross-validation/page-comparison.md) |
| 17反馈遥测、18国际化资源 | 09/10/04 | [平台记录](../evidence/legacy/cross-validation/platform-comparison.md) |
| 19重构路线 | 实施路线与00 | [平台记录](../evidence/legacy/cross-validation/platform-comparison.md) |
| README、APPENDIX-evidence、APPENDIX-review | 入口/证据/覆盖说明 | [平台记录](../evidence/legacy/cross-validation/platform-comparison.md) |

## 5. 验证和使用边界

本轮保留了资料hash、修改前文档、逐项裁决和修改差异。结构、源码摘录、链接及LF锚点由 [文档校验器](../scripts/reverse-engineering/validate.mjs)检查。国际化关键分支另用 [源码函数离线探针](../evidence/legacy/cross-validation/i18n-probe.mjs)验证，结果见 [probe-results](../evidence/legacy/cross-validation/i18n-probe-results.json)。验收记录见 [acceptance](../evidence/legacy/cross-validation/acceptance.json)。

这是静态文档交叉审计及有限离线探针，没有重跑旧扩展全流程、全站点、所有语言UI或旧后端。23篇已按目录对照，不意味着其中每一条断言已获得独立运行证明。后续实现以修正后的模块文档及源码为依据，运行验收按[路线图](implementation-roadmap.md)分批进行。

## 6. DeepSeek 修订后的复查

DeepSeek 新增逐项处理记录，共62项：接受34项（含1项“接受（新发现）”）、部分接受28项。已将其24篇修订文档和6份分析证据另存为[第二轮快照](../evidence/legacy/cross-validation/deepseek-revised-manifest.json)，原始快照保持不变。

复查发现部分旧结论仍残留于总结/表格，与修订正文冲突，见[修订后复核清单](../evidence/legacy/cross-validation/deepseek-revision-review.md)。我方也更正反馈归因：B13原文已明确截图像素比例，收回该子点质疑；B10是补充边界；D9旧文确有“永久卡在第3步”，不是指向另一份文档。具体原文位置见[归因复查](../evidence/legacy/cross-validation/feedback-attribution-errata.md)。这轮仍未修改yezi中的文档。

## 7. 最后一轮实际文件验收

已读取DeepSeek对15项的最后修订，核实62项统计更新为接受35、部分接受27；归因更正及多数正文修改已落实。最后副本另存为[最终快照](../evidence/legacy/cross-validation/deepseek-final-manifest.json)，未覆盖前两轮。

**主要内容基本对齐，但尚有一处实质内部矛盾**：04章LF1413–1414仍断言Gemini模型名不合法，与同章前文的“未确认”冲突。此外，16章朗读范围及附录开头D9归因列表还有轻微同步问题。完整位置、修改建议及已通过项见[最终验收结论](../evidence/legacy/cross-validation/final-revision-acceptance.md)。这与“15项均已完全清理”的自述有区别；此处以实际文件为准。

## 8. 三项收尾复验：通过（当前结论）

在DeepSeek补充§I.4后已再次读取实际文件：04章LF1408–1415已统一为模型/预算是否被服务端接受未确认；16章LF22已统一限定已审查的字幕及阅读路径；复核附录LF10–12已移除D9的错误归因并明确接受。16章流程图LF1745–1747也补齐登录错误不降级、异常提前降级和非登录失败的分支。62项统计为接受35、部分接受27、驳回0。

**以上三项均已关闭，前述第7节及其验收清单是收尾前的历史状态。** 本轮列出的已知文档分歧已处理，两边插件主要功能、关键逻辑和验证边界已基本对齐，可作为后续分模块重构的共同依据。这里不表示逐句等同、全分支无误或真实浏览器/后端行为已验收。

最后接受副本独立保存在[收尾快照](../evidence/legacy/cross-validation/deepseek-accepted-manifest.json)，逐项通过记录见[收尾验收](../evidence/legacy/cross-validation/closure-acceptance.json)。旧快照和问题记录保留，本轮未修改yezi文档。
