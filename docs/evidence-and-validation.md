# 证据方法、覆盖范围与交付验证

[返回总索引](README.md) · [完整证据目录](../evidence/legacy/README.md)

## 1. 分析对象与证据等级

对象是用户指定的 `/Users/jiangding/yezi`，扩展版本1.0.109。原始53文件已复制到项目，逐文件保留字节数与SHA-256；20个JavaScript文件生成可读排版版，全部语法解析无诊断。没有source map，不能恢复原始TS名称/目录、原Git历史、依赖锁文件或服务端实现。

| 等级 | 本项目中的含义 | 不代表什么 |
| --- | --- | --- |
| 原始字节 | original与inventory匹配 | 不代表商店签名已验证 |
| 静态已确认 | 读取函数体、调用方、handler、配置消费者并引用代码 | 不代表当前真实网站可达或服务有效 |
| 局部已执行 | 抽取原函数在隔离VM中对固定输入执行 | 不代表完整浏览器/页面生命周期已验收 |
| 推断/风险 | 从控制流、资源缺口、并发写入等推导 | 不声称历史上实际发生过事故 |
| 建议 | 新TypeScript模块/接口/验收设计 | 本阶段未实现 |

逐文件责任映射 [artifact-coverage.json](../evidence/legacy/artifact-coverage.json) 用于避免遗漏入口、资源和共享chunk，不表示对第三方库的每个函数做了独立业务审计。产品功能以模块文档中实际调用链为准，SDK中未被调用的音视频/文件等API不计入功能列表。

## 2. REA实际执行与Evidence ID

实际工具是本机 `rea-agents@6.8.0` 的公共CLI，Node24。本会话没有连接REA MCP工具；doctor确认Codex注册本身存在。没有为此次JS分析安装/修改Ghidra、Hopper、MCP配置或全局工具链。

### 2.1 整包尝试：部分证据，不能称完成

Evidence ID：`ev_05aaac4191718e94f6227524e98b2d26de3ca38d538dff2d97490bd64a1a18c9`。

根artifact SHA-256：`1341b092abe765b43cdd39c8062789a6c2b5cd1ecd51550a8fbac418389ba360`。

- 选择范围：整包；35个相关文本文件；读取11962427字节；统计显示解析14个JS、跳过6个JS，parse_failures=0。
- 参数：总语义节点300000、单文件40000；同等unknown上限；worker heap2048MiB；单文件300000ms。
- 在`chunks/wechat-auth-DcMIyx4V.js`分析过程中触发单文件超时；部分早先文件也因父结果容量保留静态事实、跳过语义图。
- graph/semantic coverage均为partial。**没有使用这个结果宣称自动恢复全部调用图**；后续人工静态跟踪覆盖了大bundle的业务入口与关键链路，保留格式化源和摘录。
- 沙箱禁止进程表检查，导致工具清理确认失败；随后核对并终止了此次孤立worker，确认PID不再存在，删除其专属临时目录。记录见cleanup.txt。不是通过重复不变的分析来绕过错误。
- 原始错误响应包含partial_observation，已完整保留；提取出的canonical partial Evidence也另存无损gzip。

阅读 [coverage.json](../evidence/legacy/rea/coverage.json)，原证据见 [partial-evidence.json.gz](../evidence/legacy/rea/partial-evidence.json.gz)，原失败上下文见 [full-attempt-error.json.gz](../evidence/legacy/rea/full-attempt-error.json.gz)。没有生成完整成功的full-bundle，文档不引用不存在的成功结果。

### 2.2 定向入口分析：命令成功，应用关系仍有范围限制

Evidence ID：`ev_4b89ebbb1e612baa2f4a22c2c1fa21d9310dda3c0e91f7e1256316ece60dc4b7`。

选择manifest、四个HTML入口、feedback-modal.js、video-subtitle-inject.js，共7文件。解析2个JS，visited_ast_nodes=9674，findings=31，parse_failures=0。单文件60秒，语义总20000/单文件5000，heap1024MiB。命令exit0，保留完整Evidence记录。

该结果**graphCoverage仍是partial**，原因包括28个相关文本文件被明确排除、动态/混淆表达式不能完全解析。命令成功与全应用完整是两回事。详见 [selected-entrypoints-summary.json](../evidence/legacy/rea/selected-entrypoints-summary.json) 和 [完整Evidence](../evidence/legacy/rea/selected-entrypoints-evidence.json)。

## 3. 普通静态恢复与关键素材

REA以外的解析和摘录由项目保留的Node/TypeScript工具完成，不标成REA Evidence：

- `prepare.mjs`：快照、SHA-256、惰性语法解析、排版。
- `catalog.mjs`：LF行号索引、默认值字面量解释、schema/枚举和消息常量提取；不调用目标函数，不能解析的表达式标`$expression`。
- `extract-page.mjs`：host关键声明、10站点完整内置规则和分享静态配置。
- `extract.mjs`：任意固定LF行范围复制和来源哈希。
- 页面/服务/视频/平台摘录含起止行或UTF-16偏移，后续可直接与冻结文件比对。

Windows式CR或Unicode分隔符可能在JS字面量中出现，所有文档引用按LF算行。macOS文件系统大小写不敏感，页面摘录使用“起始行号-压缩符号.js”避免q9e/Q9e等同名碰撞。

## 4. 本地离线行为探针

实际执行 [probe.mjs](../evidence/legacy/extracts/video/probe.mjs)，只把选中的原声明和最小stub放入Node VM；无DOM、无外部网络，不执行完整插件bootstrap。14项通过，详细输入断言和结果保存在代码、[probe-results.json](../evidence/legacy/extracts/video/probe-results.json)、[日志](../evidence/legacy/extracts/video/probe.log)。

覆盖：同一非CC候选组内ASR优先轨道选择、中文脚本归一化、playerResponse层级合并、5分钟timedtext缓存、JSON3时间/边界、ASR合并、环境声音标记未过滤、VTT cue设置后缀边界、二分时间轴窗口、SRT默认导出、TikTok字幕信息提取/块解析、递归重试父Promise在给定成功回调后仍未settle等。通过表示**断言观察到旧逻辑**，其中有些断言专门复现缺陷，不表示旧行为正确，也不证明所有输入或拒绝分支。特别是不能从第一项推出“YouTube始终优先ASR”。

全面复核时新增了5个离线案例：视频选轨跨CC分组与音轨缺token两个反例，及冲突扩展检查/禁用失败/恢复失败三条控制流。输入、stub、源位置和输出见 [视频对抗探针](../evidence/legacy/audit/video/adversarial-results.json)、[平台探针](../evidence/legacy/audit/platform/probe-results.json)。另对20个原始/排版JS比较语法树指纹，结果全部匹配；检查器通过空白/分号正例和数字、声明类型、一元操作符、可选链边界、指令反例自检。这个结论仅限该指纹所保留的语法结构，不是运行等价证明。[结构对照结果](../evidence/legacy/audit/format-equivalence.json)。

## 5. 资料交付校验

[validate.mjs](../scripts/reverse-engineering/validate.mjs) 检查：

1. 53份原始快照与inventory一致，且没有多出未登记文件。
2. 20份排版JS哈希一致，解析诊断为0。
3. 页面/供应商/视频/平台摘录与原范围一致，校验起止行；供应商摘录除统一来源注释后的空行外必须精确匹配整个文件，避免多出无来源内容、大小写覆盖和重排漂移。
4. 原文件全部有对应责任文档；所有模块能从入口查到。
5. README/docs/证据说明的本地链接可解析，源码LF行号没有越界。
6. 14项原离线探针和5项补充案例结果通过；原始/排版20文件的结构指纹一致；两份压缩REA证据的SHA-256一致。

校验失败会写入明确的failed报告并返回非零退出码，不用空对象替换原结果。审查记录见 [本轮总报告](audit-report.md)。

实际计数与结果以 [validation-report.json](../evidence/legacy/validation-report.json) 为准。校验链接和行范围不等于自动证明文档每一句语义正确；关键结论另外按函数与调用方复核。

新骨架既有的构建/浏览器检查与**旧插件**运行验证分开：本阶段不会把此前新骨架的基础验收算作旧插件已通过真实站点测试。文档与分析工具不接入WXT运行入口；收尾已复跑 `npm run check`，类型检查、生产构建和MV3产物验证全部通过，见 [项目检查记录](../evidence/legacy/verification/project-check.json) 和 [完整输出](../evidence/legacy/verification/project-check.log)。

## 6. 确认的缺口与后续验证边界

| 类别 | 现状 | 后续怎样补证 |
| --- | --- | --- |
| 外部服务 | 未请求Google/微软/AI/Coco真实翻译与登录 | 后续采用某服务时，在授权账户与测试输入下验证契约 |
| 后端实现 | 只有客户端路径/请求/错误处理 | 新后端明确设计，不臆造旧计费/鉴权源码 |
| 真实站点DOM | 有10站点规则与专属处理器，未逐站点线上运行 | 固定fixture后再逐站点浏览器回归 |
| YouTube私有API/签名 | 静态捕获/回退逻辑可恢复 | 当前真实播放器和多语言轨道实测 |
| 远程规则 | 保留历史URL和本地fallback，未拉取远程内容 | 后续定义新的规则分发与版本契约 |
| 分享资源 | `vditor/dist/**`声明对应目录缺失 | 新实现选择/补齐可核验本地资源 |
| 反馈静态资源 | manifest的feedback图片通配声明未在本包找到匹配项 | 先按实际渲染路径确认是否需要，不能单凭通配声明断言功能损坏 |
| 原始源码 | 无source maps与源码工程 | 用恢复的行为与关键代码重写维护性更好的TS模块 |
| 历史用户数据 | 未读取旧插件个人存储 | 将来单独设计导入/迁移，不自动跨扩展身份读取 |

因此，本次交付是覆盖安装包内主要业务模块、带证据与缺口的重构设计资料，不是“100%恢复源码”或“所有线上功能已经可用”的声明。
