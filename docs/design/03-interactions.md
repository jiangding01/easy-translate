# 03 · 划词、悬停与页面交互

本文为待实施方案。交互控制器负责收集用户意图、展示状态和管理生命周期；翻译请求由 [01](01-translation-core.md) 执行，局部 DOM 提取/恢复复用 [02](02-page-translation.md)，配置及平台接口见 [08](08-configuration-and-ui.md)、[11](11-browser-platform.md)，请求标识遵循 [13](13-protocols-and-data.md)。截图和分享见 [04](04-capture-and-sharing.md)。

```ts
type InteractionSession = { sessionId: string; generation: number; signal: AbortSignal }
type SelectionState = { source: string; targetLanguage: string; provider: string; status: 'idle'|'loading'|'success'|'error'; result?: string; error?: string; pinned: boolean }
interface InteractionController { updateConfig(config: unknown): void; dispose(): void }
```

每个控制器独立持有 generation 和资源清理集合；新请求、关闭、禁用和销毁均递增 generation 并中止，成功和失败都检查身份后才更新。`requestId` 标识一次服务调用，不能替代 DOM 或交互 generation。

## 划词和朗读

默认启用、icon 触发、最短 2 字符、不触发语言 zh-CN（旧逻辑按语言主码匹配）。鼠标松开约 100ms、键盘选择结束约 50ms 后检查非空选区；icon 点击时保留选区，dot 鼠标悬停触发，direct 直接触发，Ctrl/Option/Shift 也可按配置触发。滚动、重新选择或选区消失隐藏触发器。弹窗支持目标语言、服务切换、重试、复制、固定和拖动；外部点击关闭，固定/拖动中不关闭。

```text
translate(selection, options):
  generation++; abort(previous); capture immutable source and position
  show loading
  try result = await service.translate(source, options, signal)
      if current(generation): show result
  catch error:
      if current(generation) and not cancelled: show error with retry inputs
close(): generation++; abort(); stopSpeech(); remove listeners and UI
```

旧实现只检查旧成功，旧失败可覆盖新结果，关闭后迟到响应也可能重新打开；新设计同时屏蔽这两类结果。朗读按 items 串行，后台失败可回退 Web Speech API；停止同时通知后台并取消本地朗读，语音不可用时显示提示。

## 悬停与输入

悬停仅在开启且修饰键单独按下时生效，direct 无需按键；忽略输入区域和重复键，keyup/blur 失活。mousemove 约 100ms 节流并按配置延迟，过滤表单、按钮、不翻译区及自身 UI；以元素身份和源文版本识别变化，复用页面块提取和渲染。换目标或失活时取消局部 generation、恢复本控制器创建的译文；不删除页面翻译拥有的结果。旧实现的扫描 abort 未传入已启动翻译，松键也不保证删除译文，direct blur 清理不完整；新设计将取消和恢复贯穿请求与渲染。

输入控制器支持 textarea、text/search/email/url/tel input、contenteditable 和 role=textbox，排除密码等类型。space/slash/comma/period/semicolon 三次触发，1 秒内计数，keydown/input 双通道 50ms 去重，IME 组合期间不触发。触发后保留原始完整值originalValue和编辑版本用于并发比较，另生成requestText，移除末尾最多三个触发字符并trim；requestText为空则退出，避免把触发符送给provider。目标为 inputTranslation.firstLanguage（配置默认 en，字段缺失时旧代码回退 zh-CN）；若检测到的源语言与该目标匹配且脚本检查通过，仅移除触发符，不请求。其余情况仍请求翻译到 firstLanguage；旧逻辑没有切换到第二目标语言的分支，新设计也不虚构该分支。同语言且无需翻译时，仅在原值和版本未变时写回去触发符后的文本。普通翻译请求使用requestText。快照原值与选区，请求中不改动输入；只有值和编辑版本未变化才以原生 setter/输入事件回填，用户继续编辑则丢弃结果。富文本仅在可保留结构时替换，否则提示不支持；失败保留用户内容。初始化关闭后配置热启用必须安装监听，禁用/销毁移除每个元素监听、观察器和定时器。

## 悬浮球与快捷键

悬浮球由页面状态驱动，默认右侧 top=120，拖动边界夹取、左右吸附并保存位置；支持键盘 Enter/Space，站点及全局禁用配置，默认排除 accounts.google.com。host 被页面删除时可重建，显式关闭后不重建；所有 UI、监听、定时器和 observer 由实例销毁。PDF 主按钮进入外部文档入口；设置、分享、截图及反馈分别委托对应模块。

页面快捷键默认 Alt+X；可选普通键 300ms 内连击两次（默认键 1），排除输入区域。浏览器 commands 的截图快捷键与页面键盘配置分开，显示实际生效值并处理冲突，不能仅从配置推断浏览器命令已更新。

## 验收

- 选区两次快速请求、切换服务、旧失败晚到、关闭后响应、重试和固定/拖动均保持正确状态；关闭与销毁停止朗读。
- 悬停换元素（含相同文本）、松键、失焦、禁用和页面翻译并存时只恢复自身修改，迟到结果不回填。
- 三连触发去重、触发符不进入普通翻译请求、去符后空文本不发请求、失败保留完整原值、IME、用户中途编辑、受控输入和富文本；关闭后热启用生效，重复启停无监听泄漏。
- 悬浮球拖动、移除后重建、显式关闭、站点禁用、PDF 和两种截图入口均验证；快捷键与浏览器 commands 的实际配置分别核对。
