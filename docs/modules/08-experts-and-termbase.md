# 08 · 翻译专家、风格与术语库

[返回总索引](../README.md) · [翻译管线与 Prompt 消费](01-translation-providers.md) · [设置仓库](06-settings-and-configuration.md)

## 1. 数据与真实选择来源

旧包有两套并存字段，重构时必须消除歧义：

| 数据 | 存储键/字段 | 旧实际用途 |
| --- | --- | --- |
| 自定义专家仓库 | `local:congcong_translate_expert_config` | `{enabled,selectedExpertId,customExperts}`，保存用户专家列表 |
| 当前翻译风格 | 主配置 `ai.style` | Prompt 构建用它查内置或自定义专家；默认 builtin-general |
| 上下文增强 | 主配置 `ai.contextEnhancement` | 注入 title/domain 上下文 |
| 术语库仓库 | `local:congcong_translate_termbase_config` | `{enabled,libraries}`，按站点与库启用状态筛选术语 |

不能把专家仓库的 `enabled/selectedExpertId` 当作主翻译管线开关。后台 `WI()` 读取 `ai.style`，并从 RI().customExperts 查找，不依据专家仓库 enabled/selectedExpertId。[后台 LF2554–2590](../../evidence/legacy/formatted/background.js#L2554)、[LF2635–2654](../../evidence/legacy/formatted/background.js#L2635)。

## 2. 专家结构与内置项

```ts
// 根据旧 schema 重建的说明类型，不是恢复的原始 TS 源码。
interface TranslationExpert {
  id: string;
  name: string;              // 1–100
  styleDescription: string;  // 0–2000，默认空
  maxTextLength: number;     // 100–10000，默认1200
  maxParagraphs: number;     // 1–100，默认4
  createdAt?: number;
  updatedAt?: number;
}
```

六个内置项是 general、formal、casual、tech、academic、creative，ID 使用 builtin-*。tech 默认 maxTextLength=1500、maxParagraphs=6，academic 为 1500/4，其余 1200/4。内置项有单独本地化名称/说明表，UI 显示语言与发给模型的风格文本不能混为一谈。[DisplayModeSelector LF8–12](../../evidence/legacy/formatted/chunks/DisplayModeSelector-aVEBmg_I.js#L8)。

自定义专家 API：`no()` 读并缓存、`ro()` schema 校验并写入；`Zp()` 创建 UUID 与时间戳；`ev()` 保持 ID 更新；`tv()` 删除并清空同 ID 的 selectedExpertId；`nv()` 监听存储。旧专家结构若只有 systemPrompt，`vc()` 去掉“你是一位…翻译专家”等固定开头迁移为 styleDescription。[LF13–33](../../evidence/legacy/formatted/chunks/DisplayModeSelector-aVEBmg_I.js#L13)，完整摘录 [expert-store.js](../../evidence/legacy/extracts/platform/expert-store.js)。

关键原逻辑：

```js
async function ro(e) { const t = Ma.safeParse(e); if (!t.success)
    throw new Error("Invalid expert configuration");
    await Vn.setItem(`local:${Gn}`, t.data), Tt = t.data;
}
```

后台 Prompt 消费副本 `RI` 和页面副本 `Xbe` 都首次读取后缓存，所核对副本未见专家存储 watch；因此已加载的上下文可能继续使用旧专家快照，直到该上下文重建。管理界面自己的 `nv` watch 不等同于更新这些独立缓存。[后台 LF2569–2582](../../evidence/legacy/formatted/background.js#L2569)、[host LF1551–1564](../../evidence/legacy/formatted/content-scripts/host.js#L1551)、[管理界面 LF33](../../evidence/legacy/formatted/chunks/DisplayModeSelector-aVEBmg_I.js#L33)。这是静态推导，未运行验证。

## 3. 专家管理界面与持久化缺口

options 的 `Vb()` 提供加载/监听/增删改包装，`Gl()` 编辑名称、风格描述和两个合批参数，`Ub()` 禁止编辑/删除 builtin 专家。新增和编辑调用独立专家仓库，立即持久化。[options LF1663–1720](../../evidence/legacy/formatted/chunks/options-kLkbiu2d.js#L1663)。

**专家页点击卡片存在值得复核的持久化缺口**：`Ub()` 的 E 回调仅调用传入 setConfig，显示“已切换”；调用者 O0 传入的是 `$0()` 的 React setState，没有在这条回调内调用 Ga/updateConfig。静态链路支持“当前页面状态改变”，不支持“已持久保存”的结论。popup 的风格切换则调用 updateConfig，行为不同。建议将这点列为重构回归项，不复刻成功提示与实际保存脱节的行为。

## 4. 术语库数据模型

```ts
// 说明类型。
interface TermItem { id: string; source: string; target: string; enabled?: boolean }
interface TermLibrary {
  id: string;
  name: string;              // 1–100
  description?: string;     // <=500
  matches: string[];        // 默认 ['*']
  enabled: boolean;         // 默认 true
  items: TermItem[];
  createdAt?: number;
  updatedAt?: number;
}
interface TermbaseConfig { enabled: boolean; libraries: TermLibrary[] }
```

主数据默认 enabled=true、libraries=[]。source 必须非空，target 可为空；空 target 的 Prompt 消费表示保留 source 原样。库和词条 ID 使用 UUID；库的 createdAt/updatedAt 使用毫秒时间戳，词条模型没有这些时间戳。[wechat-auth LF7158–7186](../../evidence/legacy/formatted/chunks/wechat-auth-DcMIyx4V.js#L7158)。

CRUD 函数：Qa/Mr 读写，MU 切总开关，NU/jU/zU 管库，LU/PU/BU 管词条，DU 按 ID 查询，UU 存储监听。删除不存在条目返回 false，编辑不存在条目返回 null。UI 在 `options.a0/s0` 中封装这些接口、保存状态、选中库、确认删除与搜索。[options LF2291–2418](../../evidence/legacy/formatted/chunks/options-kLkbiu2d.js#L2291)。

## 5. JSON/CSV 导入导出

| 操作 | 旧行为 | 边界 |
| --- | --- | --- |
| JSON 导出 HU | `{version:'2.0',exportedAt,items}` | 导出当前库词条，不是整个术语库集合；库站点规则不在此格式内 |
| JSON 导入 kU | JSON.parse→schema→每项重新生成 UUID→追加或替换 | 默认追加；不是按 source 合并去重 |
| CSV 导出 IU | 固定 `source,target,enabled` 表头，字段引号转义 | 不导出 ID、库描述或站点规则 |
| CSV 导入 FU | trim 后按 LF 切行，跳过首行；逐行 `_4()` 解析，schema 过滤无效项 | 不按表头名称重新映射列；没有跨行引号字段支持 |
| 通用下载 c0 | Blob→object URL→临时 `<a download>` | 与后台 downloads API 是不同下载方式 |

代码证据：[JSON/CSV LF7186–7230](../../evidence/legacy/formatted/chunks/wechat-auth-DcMIyx4V.js#L7186)、[UI 导入导出 LF2365–2419](../../evidence/legacy/formatted/chunks/options-kLkbiu2d.js#L2365)，摘录 [termbase-io.js](../../evidence/legacy/extracts/platform/termbase-io.js)。

关键原逻辑：

```js
function _4(e) { const t = []; let n = "", a = !1; for (let r = 0; r < e.length; r++) {
    const i = e[r];
    a ? i === '"' ? e[r + 1] === '"' ? (n += '"', r++) : a = !1 : n += i
      : i === '"' ? a = !0 : i === "," ? (t.push(n.trim()), n = "") : n += i;
} return t.push(n.trim()), t; }
```

CSV 的第三列若不存在，schema 默认启用；若列存在但为空，或内容不是忽略大小写后的 `true`，则转换为 false。`v1()` 支持把含换行字段导出为引号 CSV，但 FU 先按换行切割，**导出再导入含换行术语不一定可逆**。重构应明确支持完整 CSV，或在输入阶段拒绝这种字段并解释限制；不要继续静默丢词条。

## 6. 匹配和 Prompt 接入

后台 `PI()`：`*` 全部；HTTP(S) 规则按完整 URL 的小写前缀；`*.domain` 匹配根域和子域；普通域名也匹配子域；URL 解析失败回 includes。`MI()` 筛 enabled 的库与 matches；没有 url 时仅匹配包含 `*` 的库。`NI()` 取 enabled≠false 词条，`DI()` 转 source→target 字典，**后面的同 source 覆盖前面**。

`ZI()` 对每个 source 做正则转义后，以大小写不敏感子串判断是否出现在本次原文，不是分词/词边界匹配；只把命中词条拼到 `Termbase (use these translations...)`。例如 `cat` 可命中 `concatenate`。它是模型提示，不是强制 DOM 字符串替换。[background LF2584–2634](../../evidence/legacy/formatted/background.js#L2584)。

实际消费中 `MI()` 没有检查术语库顶层 enabled，只检查单库 enabled；因此 UI 总开关不应直接记为已有效控制所有翻译。供应商还存在专家参数未实际参与合批等差异，见 [01](01-translation-providers.md)。

## 7. 建议重构接口与验收

建议保留 `ExpertRepository`、`TermbaseRepository` 和纯函数 `matchTerms(text,url)`；把“当前选中专家”统一到主配置中一个字段。仓库层检查 schema、不可变 ID、引用删除；Prompt 层只消费经过解析的当前快照。

| 批次 | 实现范围 | 验收样例 |
| --- | --- | --- |
| A | 六个内置风格+当前风格保存 | popup/options 双向一致；刷新后仍选中；删除当前自定义风格回 general |
| B | 专家 CRUD 与真实合批策略 | 名称边界；旧 systemPrompt 迁移；参数确实影响调度时再开放 UI |
| C | 术语库 CRUD、站点匹配与 Prompt | 总开关、库开关、词条开关；根/子域；无URL；重复source优先级；空target |
| D | JSON/CSV IO | BOM、CRLF、逗号、双引号、多行、空行、无效布尔值；追加/替换各自可预期 |

未知：服务模型是否严格遵守术语提示、旧用户专家库有多少种历史结构。纯前端资料不能证明服务端强制术语一致。
