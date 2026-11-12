# 专家风格、提示词与术语库设计

状态：设计稿，待实施。配置仓库见 [配置与界面](08-configuration-and-ui.md)，请求与缓存见 [翻译核心](01-translation-core.md)。本模块生成不可变 prompt 快照，不直接调用模型。

## 目标、责任与接口

统一选择一个专家、组合可选模板与术语，实时响应仓库变更；术语是模型提示而非强制替换。专家仓库管理内置与自定义项，术语仓库负责库和条目 CRUD、导入导出与修订；PromptBuilder 只接收已验证快照。

```ts
interface Expert {id: string; name: string; styleDescription: string; maxTextLength: number; maxParagraphs: number; createdAt?: number; updatedAt?: number}
interface ExpertStore {customExperts: Expert[]; revision: number}
interface TermItem {id: string; source: string; target: string; enabled: boolean}
interface TermLibrary {id: string; name: string; description?: string; matches: string[]; enabled: boolean; items: TermItem[]; createdAt?: number; updatedAt?: number}
interface Termbase {enabled: boolean; libraries: TermLibrary[]; revision: number}
interface PromptInput {text: string; targetLanguage: string; expertId: string; template?: string; context?: {url?: string; title?: string}; contextEnhancement: boolean; omitInput?: boolean}
interface PromptSnapshot {system: string; user: string; revision: string}
interface PromptBuilder {build(input: PromptInput, experts: ExpertStore, terms: Termbase): PromptSnapshot}
```

内置 `builtin-general/formal/casual/tech/academic/creative` 不允许编辑删除。名称 1–100 字，风格描述最多 2000；合批 maxTextLength 100–10000 默认 1200，maxParagraphs 1–100 默认 4；tech 1500/6，academic 1500/4。只有实现并使用合批参数后才开放编辑。用户可见本地化名称与送模型的风格说明分开。新配置 `translation.promptProfileId` 是唯一当前专家选择，删除选中自定义专家时原子回退 general；旧 selectedExpertId 与 enabled 不再作为竞争来源。

术语库名称 1–100、description 最多 500，matches 默认 `["*"]`，库及总开关默认 true，初始 libraries=[]；source 非空，空 target 表示保留 source。新 ID UUID、库时间戳毫秒；条目 enabled 缺失迁移为 true。旧存储分别是 `congcong_translate_expert_config` 与 `congcong_translate_termbase_config`，仅可经明确导出导入跨扩展 ID 迁移；旧 systemPrompt 移除固定专家开头后作为 styleDescription，保留原始备份。

## 主流程与关键逻辑

```text
build(input, experts, terms):
  expert = find(input.expertId) or builtin-general
  enabledLibraries = terms.enabled ? match enabled libraries against input.context.url : []
  matched = merge enabled items in library order, later same source wins
  matched = entries whose escaped source occurs in input.text, case-insensitive substring
  system = mandatory output-only / preserve HTML + expert.styleDescription
  user = render(template or default, targetLang, input unless omitInput)
  append matched term instructions, optional title/domain, placeholder preservation independently of template wording
  return {system, user, revision: hash(all result-affecting snapshot fields)}
```

默认指令只输出译文、不用 Markdown、保留 HTML；默认 user 包含目标语言和原文。模板变量明确为 `{{targetLang}}` 和 `{{input}}`；扫描所有 `{{...}}` 占位表达式，发现其他变量或未闭合的双花括号时显示位置并拒绝保存，导入同样校验且保留草稿，不静默删除。普通模板必须包含 `{{input}}`；omitInput 的 Coco 构建时将该变量替换为空字符串，原文只经请求 text 传送。文本含 `__CCPH数字__` 时要求完全保留所有占位符，结果校验在翻译核心执行。上下文增强开启才附 document title 和 source domain；URL 即使关闭增强仍用于术语匹配。模板与专家明确组合，术语与上下文独立追加，不依赖固定英文首句。

匹配：`*` 所有站点；`*.example.com` 与普通域名均匹配根域和子域；HTTP(S) 完整规则按规范化 URL 前缀匹配；无 URL 只匹配含 `*` 的库。无效 URL/规则保存时拒绝并报错，不以任意字符串包含作为安全边界。仅启用的库、条目参与；同 source 后项覆盖前项，按大小写不敏感子串匹配，`cat` 可命中 `concatenate`。术语目标是提示，不能保证模型遵循。

## 导入导出与生命周期

JSON 当前库导出 `{version:'2.0',exportedAt,items}`，不含库名和站点规则；导入校验后重新生成词条 ID，用户明确选追加或替换，追加不去重。CSV 表头 `source,target,enabled`，正确处理 BOM、CRLF、逗号、双引号及跨行引号；缺 enabled 默认 true，存在但非法值报告行号并拒绝整个导入，避免静默丢数据。导出不含 ID、库描述和站点规则。保存前完整解析和预览，失败不写入；替换须明确选择。增删改原子写入并递增 revision，后台与各 UI 监听统一事件并丢弃旧缓存；执行中的翻译使用其启动快照，新请求使用新 revision。

## 旧行为与新设计差异

| 旧行为 | 新设计 |
| --- | --- |
| `ai.style` 决定专家，仓库 enabled/selectedExpertId 不控制翻译 | 唯一 promptProfileId，删除选中项回退 |
| 找到专家就忽略选中模板；fallback 的术语/上下文注入依赖固定首句 | 明确组合专家和模板，独立附加上下文及术语 |
| 总术语开关未在消费链检查，专家消费者缓存未监听 | 三层开关均生效，仓库 revision 更新所有消费者 |
| 专家卡仅改组件 state 却提示已切换 | 持久化成功后更新界面及提示 |
| CSV 逐行解析，含换行字段无法可靠往返 | 标准跨行 CSV；无效行整体报错不静默丢弃 |

## 验收用例

1. 六种内置专家与自定义 CRUD、长度边界、旧 systemPrompt 迁移；popup/options 切换刷新持久，删除当前项回退。
2. 总库/单库/单词条开关，根域、子域、URL 前缀、无 URL、无效规则、重复 source、空 target 及大小写子串。
3. 模板变量、专家风格、术语、上下文与占位符同时存在；Coco 原文只出现于 text；revision 变化使缓存失效。
4. JSON 追加/替换及 CSV BOM、CRLF、逗号、双引号、多行、无效布尔值往返；任何无效导入不部分写入。
5. 多页面及后台收到同一 revision，执行中快照不变，后续请求使用新配置；合批参数确实生效后才可编辑。
