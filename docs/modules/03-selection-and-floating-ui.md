# 03 · 划词、悬停、输入翻译、悬浮球与快捷键

[返回技术方案入口](../README.md) · [页面翻译管线](02-page-translation.md)

## 1. 范围与实现位置

本模块是静态恢复，不代表真实网页中已验证所有交互。顶层 `host` 初始化 `rdt`、`nRe`、`sdt/ldt`、`Nlt`；子frame不创建这些UI。四种翻译触发最终复用服务函数或页面管理器，但UI生命周期不同，不应合并成一个巨型handler。

| 功能 | 关键符号 | 输入/输出 |
| --- | --- | --- |
| 划词 | `rdt → Yut + ndt + Jut → qut/Gut` | Selection → 弹窗原文/译文/错误 |
| 悬停 | `nRe → tRe → qY/KY → hf` | 光标命中元素 → 原页面内插入或撤销译文 |
| 输入 | `sdt → ldt → Hu` | input/textarea/editable文本 → 原位回填 |
| 悬浮球 | `Nlt → wlt → vlt → KYe` | 页面状态 → 启停、设置、分享、截图、反馈 |
| 快捷键 | host keydown、`hdt`、后台commands | Alt+X / 连击 / 截图 / 修饰键 |

完整函数摘录见 [page/index.json](../../evidence/legacy/extracts/page/index.json)，消息字段见架构/通信模块。

## 2. 划词翻译

### 2.1 事件到触发控件

`Yut` 在mousedown标记开始选择并隐藏旧控件；mouseup等待100ms后读取window.getSelection。方向/Home/End/Page键或Shift选择在keyup后等待50ms重新判断。要求配置enabled、Selection非collapsed、trim长度≥minLength且当前未禁用、检测语言不在noTriggerLanguages。

- `icon`：显示24px翻译图标，click才请求；阻止mousedown/mouseup默认动作防止丢失选区。
- `dot`：显示10px圆点，mouseover即触发，不是点击触发。
- `direct`：鼠标选择结束后直接请求。
- `ctrl/option/shift`：选区存在时keydown捕获相应修饰键，preventDefault后翻译。
- 滚动/新mousedown/选区消失时隐藏触发控件；来自翻译弹窗内部的事件不会重新触发。
- 默认enabled=true、trigger=icon、minLength=2、noTriggerLanguages=[zh-CN]。过滤时按语言主码比较，因此zh-CN会连带屏蔽同主码中文变体。

证据：[`Yut`：host.js L105672–L105699](../../evidence/legacy/formatted/content-scripts/host.js#L105672)、[`ndt`：host.js L105746–L105803](../../evidence/legacy/formatted/content-scripts/host.js#L105746)、[`rdt`：host.js L105804–L105812](../../evidence/legacy/formatted/content-scripts/host.js#L105804)，默认配置 [host L1684](../../evidence/legacy/formatted/content-scripts/host.js#L1684)。

### 2.2 校验、请求、竞态与重试

`Jut.translateSelection` 再次验证选区长度和定位 `hX`，读取最新配置；自动检测源语言，以 `language.targetCode` 为目标；AI开启时用aiTranslate.provider/model，否则普通provider。`Xut/Zut` 将弹窗显示的服务id解析为实际provider/model/temperature/context。

每次请求递增 `activeRequestId`。仅在 `M9`成功返回后比较id，旧成功结果会抛 `$4("stale request")`；旧请求若直接失败，catch仍会调用 `showError`，可能覆盖较新的结果。关闭或dispose也不递增id，尚在进行的请求返回后可能重新显示弹窗；此防护不会取消旧网络请求。相同选区可在弹窗切换目标语言/提供方，重新loading；错误状态保留原文与参数，通过onRetry复用同一个performTranslate闭包。

`qut`保存 `visible/position/originalText/translatedText/sourceLang/targetLang/provider/loading/errorMessage`。已固定或手动拖动后，下一次展示沿用当前位置；关闭清理pin/manualPosition和retry回调并停止语音。点击弹窗外关闭，拖动/固定时不关闭。复制调用clipboard；临时禁用由本页状态控制，全局禁用写 `selectionTranslation.enabled=false`。

证据：[`Jut`：host.js L105718–L105744](../../evidence/legacy/formatted/content-scripts/host.js#L105718)、[`qut`：host.js L105657–L105670](../../evidence/legacy/formatted/content-scripts/host.js#L105657)；服务选择和重试UI [host L105473–L105655](../../evidence/legacy/formatted/content-scripts/host.js#L105473)。

### 2.3 朗读

`Gut`优先向后台发送 `ttsSpeak({items})`，失败回退Web Speech API，按items顺序串行播放，通过会话序号阻止旧朗读继续推进；停止发送 `ttsStop` 并取消本地speechSynthesis。语言选择和可用voice取决于系统，安装包不能证明所有语种均有声音。

证据：[host L105475–L105554](../../evidence/legacy/formatted/content-scripts/host.js#L105475)。后台TTS实现应结合后台通用能力模块。

### 2.4 旧代码边界

`qut.setupClickOutsideHandler` 注册匿名document.click监听；`dispose`只移除容器，未见对应removeEventListener与React root.unmount，存在重建后监听遗留风险。这是从代码观察出的风险，未做泄漏运行证明。重构应让每个listener都有明确cleanup。

## 3. 悬停翻译

`nRe`负责修饰键状态：Control/Shift/Alt必须单独按下，不允许同时带其他修饰；排除输入场景、repeat事件；keyup/window.blur停用。hotkey=direct时不依赖按键。


来源：[`nRe`：host.js L10527–L10534](../../evidence/legacy/formatted/content-scripts/host.js#L10527)；[完整摘录](../../evidence/legacy/extracts/page/10527-nRe.js)。

```js
function nRe(e) { const t = tRe(e); let n = e, r = t.getHotkey(), o = !1; const d = M => { var R; if (!((R = n == null ? void 0 : n.hoverTranslation) != null && R.enabled))
        return !1; switch (r) {
        case "Control": return M.key === "Control" && M.ctrlKey && !M.altKey && !M.shiftKey && !M.metaKey;
        case "Shift": return M.key === "Shift" && M.shiftKey && !M.ctrlKey && !M.altKey && !M.metaKey;
        case "Alt": return (M.key === "Alt" || M.key === "Option") && M.altKey && !M.ctrlKey && !M.shiftKey && !M.metaKey;
        default: return !1;
    } }, p = () => { o && (o = !1, t.setHotkeyActive(!1)); }; return { handleKeyDown: (M, R) => { r !== "direct" && !R && d(M) && !o && !M.repeat && (o = !0, t.setHotkeyActive(!0)); }, handleKeyUp: M => { if (r === "direct")
            return; const R = M.key === "Option" ? "Alt" : M.key; (r === "Control" && R === "Control" || r === "Shift" && R === "Shift" || r === "Alt" && R === "Alt") && p(); }, handleWindowBlur: p, updateConfig: M => { var I; n = M, (I = n == null ? void 0 : n.hoverTranslation) != null && I.enabled || p(); const R = t.getHotkey(); r !== R && (p(), r = R); }, dispose: () => { p(), t.dispose(); } }; }
```


`tRe`仅启用时监听mousemove，100ms节流，实际等待至少50ms并遵守配置delay。命中元素通过 `eRe` 和 `Oe`过滤禁用标签、表单/按钮、反馈弹窗、译文wrapper和不翻译区域；文本长度采用悬停专用上下限。通过 `qY/KY`提取该局部的候选片段，调用 `hf`复用普通HTML保留与渲染。

检测到的文本变化时会安排新扫描；新扫描启动后abort上一扫描并增加序号，扫描循环检查信号和序号。但调用 `hf` 时没有传入该AbortSignal，已经进入的翻译请求及其回填不受这次abort直接保护。比较对象是归一化后的文本，不是元素身份，相同文本的不同元素不一定触发新扫描。若局部已存在译文，对已有译文执行hf恢复分支。mixed短文本原文策略仍生效。释放修饰键、禁用或dispose会清理扫描和定时器；direct模式下窗口blur的修饰键处理不触发这一清理。已插入的悬停译文也不会因松开修饰键自动移除；禁用/dispose的 `fr` 仅查询 `[data-hover-translation="true"]`，当前 `hf` 路径未见赋此属性，故不能保证该清理会移除已渲染译文。

证据：[`tRe`：host.js L10470–L10526](../../evidence/legacy/formatted/content-scripts/host.js#L10470)、[`nRe`：host.js L10527–L10534](../../evidence/legacy/formatted/content-scripts/host.js#L10527)、[host L10454–L10469](../../evidence/legacy/formatted/content-scripts/host.js#L10454)。

## 4. 输入框翻译

支持textarea、无type或text/search/email/url/tel input、contenteditable非false、role=textbox；未包含password/number等。初始扫描并观察新DOM。每个元素保存triggerState弱引用和translating弱集合。若初始化时输入翻译已禁用，`sdt` 返回空的 `updateConfig/dispose`，后续仅靠配置更新不会在本次实例中启动输入监听（[host L105967–L105968](../../evidence/legacy/formatted/content-scripts/host.js#L105967)、[L105991–L105992](../../evidence/legacy/formatted/content-scripts/host.js#L105991)）。

`keydown`与`input`双通道识别触发字符：space/slash/comma/period/semicolon。忽略isComposing/正在翻译；50ms内双通道事件去重；相邻触发超过1秒重置；连续3次触发激活。非触发键/输入重置计数。

激活后去掉末尾最多3个触发字符、trim；若空白退出。`inputTranslation.firstLanguage`实际上是**输入翻译目标语言**，不是网页目标语言：复制配置并仅替换language.targetCode后调用Hu。若源检测与firstLanguage匹配且文字脚本符合，直接去除触发字符回填，不请求。

翻译中每400ms给源文追加动态省略点；成功先淡出再回填，失败恢复源文并临时placeholder提示3秒。input/textarea设value并dispatch冒泡InputEvent，光标移动至末尾；contenteditable设textContent并重建Range。

风险：翻译期间会覆盖输入值，旧逻辑未见“用户继续编辑后拒绝回填”的source snapshot检查；editable回填textContent会丢弃富文本结构。`dispose`清Set/Observer但未遍历执行每个元素保存的listener清理闭包，需重新设计资源清理。以上是静态观察，不等于已复现实例。

证据：[`ldt`：host.js L105878–L105965](../../evidence/legacy/formatted/content-scripts/host.js#L105878)，[host L105967 起sdt](../../evidence/legacy/formatted/content-scripts/host.js#L105967)。完整输入关键代码：[ldt.js](../../evidence/legacy/extracts/page/105878-ldt.js)。

## 5. 悬浮球

`Nlt`基于当前hostname、floatingBall.hasBanAllSiteMountFloat与mountFloatSite的hasBan精确站点规则控制挂载；默认排除accounts.google.com。位置为top=120、side=right，拖动后写floatingBall.position。普通页面支持半隐藏，PDF页面采用不同展开逻辑。

`wlt`创建 `congcong-translate-floating-ball`，优先open ShadowRoot（失败回退普通DOM），React/UI库容器都挂在该host，400ms检测host被页面删掉后重建，显式关闭后不重建。`KYe`实现pointer capture、边界夹取、左右吸附、拖动与点击区分，键盘Enter/Space激活。

`vlt`以页面管理器状态驱动loading/成功图标和可用性：

| 操作 | 实际行为 |
| --- | --- |
| 主按钮 | 非PDF：canTranslate检查后toggle/stop；PDF：打开外部文档站点 |
| 设置 | `openUrl({url:'/options.html'})`交后台打开 |
| 分享 | 打开分享面板并从页面重新提取原文/翻译 |
| 截图 | `jle`，截图时隐藏悬浮球，结束恢复 |
| 反馈 | 注入反馈modal，收集及提交资料见反馈模块 |
| 关闭 | 本次移除，或写当前站点禁用/全局禁用；配置变更重新评估挂载 |

注意主按钮的“停止”判断依赖translationStatus；isActive持续为true时completed状态也可作为“翻译已开启”。UI应使用统一状态而非各处另维护一份开关。

证据：[`Nlt`：host.js L103255–L103262](../../evidence/legacy/formatted/content-scripts/host.js#L103255)、[`wlt`：host.js L103230–L103254](../../evidence/legacy/formatted/content-scripts/host.js#L103230)、[`vlt`：host.js L103146–L103221](../../evidence/legacy/formatted/content-scripts/host.js#L103146)、[`KYe`：host.js L20437–L20490](../../evidence/legacy/formatted/content-scripts/host.js#L20437)。

## 6. 快捷键与冲突

- 页面keydown优先识别 `shortcuts.togglePageTranslation`，默认Alt+X，preventDefault/stopPropagation后toggle。
- `hdt`支持指定普通键在300ms窗口内连续2或3次触发，默认键`1`连击2次；输入/editable内不会触发；不同键重置。
- hover独立使用Control/Shift/Alt状态，不等同于全局toggleHoverTranslation字符串。
- 截图由manifest.commands的默认Ctrl+Shift+Z（mac Command+Shift+Z）进后台，再发startScreenshot；配置中还保存startScreenshot，悬浮球显示该值，但“修改配置是否一定同步Chrome命令”必须结合后台commands更新代码，不应仅凭UI文案断定。


来源：[`hdt`：host.js L106043–L106047](../../evidence/legacy/formatted/content-scripts/host.js#L106043)；[完整摘录](../../evidence/legacy/extracts/page/106043-hdt.js)。

```js
function hdt(e, t) { let r = 0, o = 0, d = ""; const p = () => { r = 0, o = 0, d = ""; }; return { handleKeyDown: w => { const N = t(); if (!(N != null && N.enabled) || IY(w.target))
            return; const M = w.key, R = Date.now(), I = N.key, h = N.tapCount; if (M !== I) {
            p();
            return;
        } R - o > 300 || d !== M ? r = 1 : r++, o = R, d = M, r >= h && (w.preventDefault(), w.stopPropagation(), p(), e()); }, dispose: () => { p(); } }; }
```


入口：[host L106004–L106013](../../evidence/legacy/formatted/content-scripts/host.js#L106004)，后台commands另见后台模块。

## 7. 分批重构建议（未实施）

1. 先将Selection触发与弹窗状态分离，支持icon和明确错误，再加入语言/服务切换和请求序号。弹窗渲染只接收显式状态与回调。
2. 页面管线可稳定restore后再实现hover，复用提取/渲染而不新建第二份DOM规则。
3. 输入翻译独立为编辑器适配层；回填前比较源值快照，优先保留富文本，不复用旧textContent破坏式回填；输入中、组合输入和超时都可退出。
4. 悬浮球仅是页面会话控制面板，位置/禁用规则单独存储，所有监听和定时器归可销毁实例。
5. 快捷键采用一种规范化表示；Chrome commands与页面快捷键分开配置并检测冲突。连击普通键作为可选功能，防止影响网页已有快捷键。

## 8. 验收清单与未知

- 鼠标/键盘选区、中文禁用、空白和2字符边界；图标点击不丢失Selection，dot需悬停，direct无需点击。
- 快速划词两次、切换目标语言/提供方、请求失败重试、拖动/固定/外部点击；重构应覆盖旧请求失败及关闭后返回的竞态，旧实现未完全防护。
- hover按下/松开/失焦、多修饰键、输入焦点、重复mousemove，只影响局部且无残留译文。
- 输入三连字符双通道去重、IME、失败恢复、用户中途编辑、React受控input和editable富文本。
- 悬浮球拖动/吸附、页面删除host、站点禁用/全局禁用、PDF与普通页、截图隐藏/恢复。
- 朗读串行与停止、系统无声音、后台失败回退；没有联网验证音色或模型服务。

全部为安装包静态恢复，交互兼容性与上述风险需在后续实现阶段以本地fixture运行验收。
