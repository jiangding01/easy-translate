# 配置、弹窗与设置界面设计

状态：设计稿，待实施。配置服务是唯一写入和广播源；翻译、账户与专家分别见 [翻译核心](01-translation-core.md)、[账户与服务](09-account-and-services.md)、[专家与术语库](10-experts-and-termbase.md)。

## 目标、责任与数据

支持 popup 当前页面操作、options 的 general/display/subtitle/expert/termbase/advanced 路由及四步 onboarding。只展示已实现的能力；UI 使用后台配置仓库，不直接互相写存储。新扩展 ID 的 storage 与旧扩展隔离，不能自动读取旧数据；仅由用户从旧扩展导出并在新扩展明确导入，或通过双方明确支持的迁移通道迁移。导入前预览、备份并提示敏感字段；默认导出不包含密钥和 token。

```ts
interface ConfigV1 {
  schemaVersion: 1;
  textRange: {minLength: number; minWordCount: number; maxLength: number};
  language: {sourceCode: string; targetCode: string; systemCode: string};
  pageTranslation: {enabled: boolean; range: 'main'|'all'; translateFullPage: boolean; initialTranslateChars: number; autoSites: string[]; neverSites: string[]; alwaysLanguages: string[]; neverLanguages: string[]};
  display: {mode: 'mixed'|'bilingual'|'replace'; shortTextThreshold: number; keepShortOriginal: boolean};
  hover: {enabled: boolean; key: string; delayMs: number};
  selection: {enabled: boolean; trigger: 'direct'|'icon'|'dot'|'ctrl'|'option'|'shift'; minLength: number; excludedLanguages: string[]};
  input: {enabled: boolean; firstLanguage: string; triggerChar: string};
  translation: {ordinaryProviderId: string; aiEnabled: boolean; aiProviderId: string; promptProfileId: string; contextEnhancement: boolean};
  providerSettings: Record<string, {model?: string; baseURL?: string; temperature?: number; credentialScopeId?: string}>;
  requestQueue: {maxConcurrent: number; requestDelayMs: number; retryTimes: number; timeoutMs: number};
  cache: {enabled: boolean; maxSizeMiB: number; ttlDays: number};
  floatingBall: {side: 'left'|'right'; top: number; hiddenSites: string[]; hiddenEverywhere: boolean};
  subtitle: {mode: string; sourceLanguage: string; targetLanguage: string};
  shortcuts: {togglePage: string; secondary: string; doublePressOne: boolean};
}
interface ConfigRepository {
  get(): Promise<ConfigSnapshot<ConfigV1>>;
  patch(patch: ConfigPatch): Promise<ConfigSnapshot<ConfigV1>>;
  reset(path: string, expectedRevision: number): Promise<ConfigSnapshot<ConfigV1>>;
  subscribe(listener: (snapshot: ConfigSnapshot<ConfigV1>) => void): () => void;
  importLegacy(raw: unknown): Promise<{config: ConfigV1; warnings: string[]}>;
}
```

类型为语义说明；消息边界使用共享 `ConfigPatch {expectedRevision: number; changes: Array<{path: string; value: unknown}>}` 与 `ConfigSnapshot<T> {schemaVersion: number; revision: number; data: T}`。expectedRevision 必填；旧版本返回冲突。仓库内部可以把已校验的 path/value 转成深层 patch，数组整体替换，但不得绕过路径白名单、revision 检查或消息契约。ordinaryProviderId保存普通服务选择，aiProviderId保存独立AI选择。aiEnabled开启时选aiProviderId，关闭时恢复ordinaryProviderId；缺失或不支持的选项返回配置错误，不静默切换服务。providerSettings按provider保存model、baseURL、temperature及credentialScopeId，实际key由后台敏感仓库按scope读取。密钥使用独立本地敏感数据存储，不进入普通导出或诊断。专家及术语仓库独立版本化，引用使用稳定 ID。字幕、显示样式等模块专属配置在各模块实施时按其契约扩展；未知旧字段保留在迁移备份中，不静默当作已支持。

## 默认值、边界和操作

| 分组 | 新默认（沿用已确认旧对象） | 边界 |
| --- | --- | --- |
| textRange | 10 字符、2 词、最大 5000 | 长度 0–5000，词数 0–100 |
| language | source auto、target zh-CN；system 首次由浏览器语言归一化，未知 en | 不随每次启动重算 |
| 页面 | enabled、all、translateFullPage=false、初始 4999 字符 | 初始 0–50000；自动站点 `*.tiktok.com`、`*.instagram.com`、`*.youtube.com`；禁止为空；always en/ja、never zh-TW/zh-HK |
| 显示 | mixed、短文本阈值15、保留短原文 | bilingual/replace 可选；样式的具体枚举随显示模块定义 |
| 悬停/划词/输入 | enabled；Control、0ms / icon、最短2、排除 zh-CN / firstLanguage=en、space | 悬停延迟 0–5000ms；输入 space 为三连触发 |
| 服务/队列/缓存 | google；AI 关闭、openai、gpt-5-mini、builtin-general、上下文开启；10/0ms/1/30000ms；100MiB、7天 | 真实并发、超时取消和缓存语义见翻译核心；ttlDays=0 或 maxSizeMiB=0 关闭持久缓存，负数无效 |
| 其他 | 悬浮球右侧 top=120，隐藏 accounts.google.com；字幕 dual、auto→zh-Hans；快捷键 Alt+X、Ctrl+Shift+Z、双击1 | Chrome commands 与页面键盘触发须各自验证 |

旧版本完整默认值及站点规则用于迁移参考：[旧默认配置](reference/legacy-default-config.json)、[旧站点规则](reference/legacy-site-rules.json)。这些参考数据不是新 schema 或生效配置；不要直接把表达式标记当作值。

## 迁移、读写和界面流程

```text
load(raw):
  if absent: save(validatedDefaults())
  else if legacy: backup(raw); migrated = migrateRawBeforeValidation(raw)
  else: migrated = migrateNewSchema(raw)
  validate(migrated); on failure retain backup and surface recovery choice
  commit atomically; publish one revision
patch({expectedRevision, changes}):
  serialize writes; reject stale revision; validate allowed paths
  nextData = apply validated changes with arrays replaced
  nextSnapshot = {schemaVersion, revision: current.revision + 1, data: nextData}
  validate(nextSnapshot); persist whole nextSnapshot in one storage key write
  after persistence succeeds: publish memory snapshot; reply; broadcast
```

旧主键为 `congcong_translate_config`，版本 18；识别其结构后按版本顺序迁移，再映射到新 schema：

| 旧版本门槛 | 必要转换 |
| --- | --- |
| <2 | 划词 autoTranslate/showButton 转 trigger，补长度及排除语言 |
| <3 | autoTranslateEnglish 转 alwaysLanguages，补输入配置 |
| <4、<8、<10 | 补显示默认值 |
| <5 | 补 translateFullPage=true（仅旧版本迁移；全新安装为 false） |
| <6 | showOriginal=false 转 replace |
| <7 | general/formal 等风格转 builtin-* |
| <9 | range=all；输入 targetLanguage 转 firstLanguage；zh 转 zh-CN |
| <11、<13、<14 | 分别移除 fontSize、自定义字体字段、fontWeight，备份原值 |
| <12 | 字体不在四种内置项时回 default |
| <16 | 旧字幕百分比或过大字号回当前默认 |
| <17 | lineBreak=alwaysNewLine |
| <18 | 悬浮球隐藏加入 accounts.google.com |

无单独 <15 迁移，不补造。版本18的旧数据仍需映射新字段名、单位及专家选择：provider.provider映射ordinaryProviderId，aiTranslate.provider映射aiProviderId，aiTranslate.enabled映射aiEnabled，各provider的model/baseURL/temperature进入providerSettings；旧 expert `systemPrompt` 转 styleDescription，旧术语库单独迁移。只在旧 schema 合法性可判断时逐字段转换；未知结构报告具体字段并保留原件，不覆盖成默认值。旧数据迁移不等于跨扩展自动读取，也不迁移账户会话到新扩展。

Popup 读取当前tab与页面控制器确认的translation state，toggle 成功后回读；失败回滚并显示错误。切换服务/显示模式对正在翻译的页面触发 revalidation。站点自动/禁止规则互斥，默认只为当前精确 hostname 建规则，公共后缀感知的域名扩展须显式选择，避免把 `a.example.co.uk` 扩成 `*.co.uk`。语言标签统一大小写及 `_`/`-` 后匹配语言与子标签。

Options 表单可 500ms 防抖保存；初始化回填不触发写入，保存失败保留草稿并提示重试。服务测试使用13章独立的ProviderConnectionTest消息携带未提交model/baseURL/key草稿，仅可信设置页可调用；候选参数不落盘、不进正式缓存，响应脱敏，明确保存才提交。缓存管理显示字节/条数并清空，配置导出与缓存导出区分。Onboarding 包含演示激活、显示模式、固定工具栏、可选登录；预览请求按 generation 取消，固定 API 不可用时允许继续并说明。完成标记只在用户完成或跳过引导时写入，登录失败不误记成功；卸载时清监听和定时器。

## 旧行为与设计差异

| 旧行为 | 新设计 |
| --- | --- |
| 并发读改写无锁，后台和 options 均可广播 | 单写入队列与单广播源，revision 防丢更新 |
| 先校验再迁移，损坏数据可能退默认 | 原始备份、先迁移再校验，失败可恢复 |
| 服务对话框测试先保存，取消不回滚 | 测试草稿无副作用，显式保存 |
| popup 乐观反转不检查 success；站点按最后两段猜域 | 以响应和回读确认；精确域名或公共后缀规则 |
| 引导预览可能旧结果覆盖新结果，登录前即记完成 | generation 与取消，完成状态独立于登录结果 |

## 验收用例

1. 全新安装与各门槛旧配置、缺字段、损坏结构、数组替换和并发更新；验证备份、警告、版本及不丢字段；worker重启后revision保持，重启前的旧补丁返回冲突。
2. 新旧扩展 ID 隔离；明确导入前不读取旧存储，导出无秘密，导入预览及失败回滚。
3. tab 切换、worker 重启、toggle 失败及 revalidation 后 UI 与实际状态一致；公共后缀域名不扩大规则。
4. 修改尚未保存的地址和key后，测试使用候选值而非旧持久值；成功/失败/取消均不改变配置或泄露凭据；保存失败保留草稿；广播可重复投递，但多页面对同一revision只应用一次。普通/AI选择分别保存，开关切换不丢失各自model和端点。
5. 引导快速切语言不展示陈旧预览，固定 API 不可用、跳过登录和登录失败均可正确完成。
