# 10 · 国际化、资源与构建边界

[返回总索引](../README.md)。本模块补充与 DeepSeek 文档交叉核验后确认的内容；只描述安装包可观察的客户端实现。

## 1. 两套国际化机制

`_locales` 有 en、es、fr、ja、ko、zh_CN、zh_HK、zh_TW 八个目录，manifest 的名称和描述使用 `__MSG_…__`。它与 React/页面控件使用的业务词典是两套数据；不能把 locale JSON 的词条数当成全部 UI 文案。来源：[manifest](../../evidence/legacy/original/manifest.json)、[中文 locale](../../evidence/legacy/original/_locales/zh_CN/messages.json)。

业务词典可在共享 UI chunk、background、host 和 video-subtitle 四份 bundle 找到。共享 UI chunk 中 `c/C` 等对象合并成 `x`，语言包含 zh-CN、zh-TW、zh-HK、en、ja、ko、es、fr。`ee` 是 React Provider，`ae` 返回按指定语言取词的函数。Provider 启动读取 `language.systemCode` 并订阅配置变化；初始语言默认 zh-CN。来源：[GoogleIcon chunk LF2–19](../../evidence/legacy/formatted/chunks/GoogleIcon-BH2pAel4.js#L2)。共享副本的精确逻辑如下，不能仅凭名称把 `systemCode` 当作网页翻译目标语言。

## 2. 查词、缺词与插值

```js
// ae 的查词核心；与 ee 的 t 使用相同表达式
const t = P(x[e] || x["zh-CN"], a) ?? a;
return w(t, l);
```

来源：[共享 chunk LF17–19](../../evidence/legacy/formatted/chunks/GoogleIcon-BH2pAel4.js#L17)。行为分为两层：

- **整个语言对象不存在**：使用 zh-CN 词典。
- **语言对象存在但 key 缺失**：直接显示 key，不再去查 zh-CN 或英文词典。

`P` 先查对象自己的完整 key，接着按 `.` 分段访问嵌套对象；后者是嵌套寻址，不是跨语言回退。非字符串结果视为缺词。`w` 用 `/\{(\w+)\}/g` 插值；传了参数对象时，缺失/nullish 参数替换为空串，未传参数对象则原样保留占位符。来源：[共享 chunk LF5–12](../../evidence/legacy/formatted/chunks/GoogleIcon-BH2pAel4.js#L5)。

因此 DeepSeek 18 所述“目标语言 → zh-CN → key”需要改为上述分支；也没有必要把英文 fallback 留作这条共享查词路径的未知项。这里并未将共享副本的结论无条件推广到所有 bundle 的每个 helper。

## 3. 文案与产品能力的区别

词典里的客服二维码、进阶专家字段、富文本等文案只能证明字符串存在。必须继续找到组件、事件及消费者，才能认定功能可用。动态拼接 key 也意味着仅搜索固定字符串没有命中，不能证明全包没有消费者。关于专家和实际字段，见 [08](08-experts-and-termbase.md)；关于字幕配置消费边界，见 [05](05-video-subtitles.md)。

网页、字幕、界面语言使用的代码存在 zh-CN/zh-TW 与 zh-Hans/zh-Hant 等差异。重构需要保留各 provider 的映射，在业务入口归一化；不应直接把所有协议中的语言字符串改成一个值。

## 4. 资源缺失与注入

包内有 popup/options/login/onboarding 的四份 CSS、图标和两种页面注入脚本。`feedback-modal.js` 使用 `document.createElement` 构建 DOM；它不是独立 React 根。来源：[反馈脚本 LF100–125](../../evidence/legacy/formatted/feedback-modal.js#L100)。字幕注入桥见 [05](05-video-subtitles.md)，反馈 CustomEvent 桥见 [09](09-browser-platform-and-feedback.md)。

manifest 声明 `assets/feedback-*.png`、`vditor/dist/**`，实际快照没有对应文件。部分 Vditor 代码确实内联在 host，但分享编辑器仍构造本地 `/vditor/dist/index.js` 和 `/vditor/dist/js/lute/lute.min.js` URL；不能以“已内联”为由认定这组资源声明无影响。来源：[host LF100624–100625](../../evidence/legacy/formatted/content-scripts/host.js#L100624)、[分享模块](04-screenshot-and-reading.md)。反馈图片是否曾在历史构建中内联，没有足够证据。

## 5. 重构与验收

建议使用单一词典来源和明确的缺词规则，避免手工维护多份 bundle 数据；是否按语言拆包应由后续构建体积决定。保留 manifest 本地化和 UI 国际化两类入口。恢复资源时只迁移真实消费者需要的文件。

后续验收覆盖：语言对象不存在、已有语言缺 key、完整含点 key 与嵌套 key、缺插值参数、配置更新后的 UI 切换，以及分享编辑器本地资源加载。当前没有做全语言逐屏视觉校对或实际旧分享面板运行验证。
