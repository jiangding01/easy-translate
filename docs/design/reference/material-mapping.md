# 材料来源、覆盖映射与恢复

## 1. 整理基线

本方案依据旧版1.0.109安装包的插件端恢复结果、模块文档、已核对的架构图、双方交叉验证修订和本地探针结论整理。历史后端内部实现、缺失编辑器资源的具体版本及原始TypeScript源码无法由现有材料确定。

原始配置、完整枚举与十站点规则已保留为本目录的可移植JSON。正文采用语义类型和关键伪代码，原压缩符号、源码LF范围及所有完整代码摘录在备份中留存。

## 2. 模块迁移映射

| 原项目材料 | 新技术方案 |
| --- | --- |
| modules/00-architecture、architecture-diagrams | 00整体架构、13契约、diagrams |
| modules/01-translation-providers | 01翻译核心、10Prompt、13身份与错误 |
| modules/02-page-translation | 02页面、reference/legacy-site-rules.json |
| modules/03-selection-and-floating-ui | 03交互、11平台TTS |
| modules/04-screenshot-and-reading | 04截图分享、12资源 |
| modules/05-video-subtitles | 05YouTube字幕 |
| modules/05a-subtitle-reading | 06阅读与文章 |
| modules/05b-tiktok-captions | 07TikTok |
| modules/06-settings-and-configuration | 08配置界面、13配置协议 |
| modules/07-account-and-backend | 09账户服务、06文章契约 |
| modules/08-experts-and-termbase | 10专家术语 |
| modules/09-browser-platform-and-feedback | 11平台、12权限、13消息 |
| modules/10-i18n-and-assets | 12国际化资源 |
| implementation-roadmap | 14实施验收 |
| audit-report、deepseek-cross-validation、plugin-coverage-status、legacy-audit | 15兼容决策及各模块差异表，完整审查历史入备份 |
| evidence-and-validation、evidence、分析脚本及DeepSeek材料 | 归档留存，关键功能事实已进入正文，配置与规则提取到本目录 |

DeepSeek的24篇文档覆盖架构、协议、配置、翻译核心、provider、专家、页面、显示、交互、站点、视频、各UI、账户、截图/TTS、遥测、资源及路线。其修订结果已通过上述功能模块吸收，历史逐条接受/部分接受记录留在压缩包。

## 3. 归档位置与核验

下载目录中的归档文件名、SHA-256、大小与文件数量见[archive.json](archive.json)。另有同名`.sha256`文件。压缩包内部的`BACKUP-MANIFEST.json`包含每个成员的路径、字节数及SHA-256。

归档覆盖整理前项目docs、完整evidence、专用分析脚本、项目README与界面约定、gitignore，以及yezi原始目录。依赖目录、生成产物和Git数据库不属于本次逆向资料归档范围。

需要原始代码证据时，将压缩包解压到独立目录，按清单取回对应材料。原始链接中的`#L数字`表示当时冻结排版副本按LF计算的行号，应与对应快照搭配使用。

## 4. 设计验收边界

本轮核验备份成员完整性、资料到模块的映射、文档相对链接、JSON、代码围栏和关键设计契约一致性。浏览器、provider、视频站及账户服务测试按14章实施批次执行。
