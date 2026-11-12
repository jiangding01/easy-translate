# 12 国际化、资源与构建设计

[方案入口](README.md) · [配置与界面](08-configuration-and-ui.md) · [平台能力](11-browser-platform.md)

## 1. 目标与责任

为扩展页面、页面内控件、字幕、菜单与引导提供一致的文案和资源。维护manifest本地化及业务UI词典两类入口，由同一组UI语言代码驱动。UI语言、源语言和目标语言分别建模，切换译文目标不隐式修改界面语言。

## 2. 国际化契约

```ts
type UiLocale = 'zh-CN' | 'zh-TW' | 'zh-HK' | 'en' | 'ja' | 'ko' | 'es' | 'fr';
type MessageParams = Record<string, string | number>;
interface I18nService {
  setLocale(locale: UiLocale): void;
  translate(key: string, params?: MessageParams): string;
}
```

manifest通过`_locales/*/messages.json`提供扩展名称和说明。业务词典使用一个源目录，构建到各入口需要的模块。相同源码可以被打进多个执行上下文，但不手工维护四套业务词典。

新设计缺词策略采用“当前语言key → zh-CN同key → key”，并在开发检查中报告缺词。此处是明确的行为调整。旧共享helper只在整个语言对象不存在时使用zh-CN，已有语言缺key直接显示key。

```text
translate(key, params):
  value = lookupExactThenNested(localeDictionary, key)
  if value is absent: value = lookupExactThenNested(zhCNDictionary, key)
  if value is absent: return key
  if params is absent: return value
  return replace {name} with provided value, preserving missing placeholders
```

完整含点key优先，再按`.`访问嵌套对象。新模板要求参数名可静态检查，生产缺少参数时保留占位符并记录有限的开发诊断。旧helper在已传参数对象但某参数缺失时替换为空串，迁移测试需覆盖这项差异。

## 3. 语言归一化

配置保存规范化语言代码，provider映射在适配器内进行。UI支持的八种语言只是界面范围，翻译语言集合独立维护。旧枚举的完整清单保存在[语言及功能枚举](reference/legacy-enums.json)。

zh-Hans/zh-Hant与zh-CN/zh-TW在各协议中的映射必须显式，不能简单把相同主码当成所有产品场景的相同语言。Google/MS、字幕轨道匹配和划词排除规则分别测试中文变体、日文混汉字、未知代码、`_`分隔及大小写。

## 4. 资源所有权与加载

| 资源 | 打包与加载 | 验收 |
| --- | --- | --- |
| 16/48/128图标 | public本地资源 | manifest路径存在、popup/options可显示 |
| UI样式 | 当前CSS Modules，页面内样式在模块内管理 | 小窗口、主题、宿主样式隔离 |
| YouTube页面注入 | 最小本地脚本，按需web_accessible_resources | 失败可重试、重复注入去重、销毁恢复hook |
| 反馈界面 | 扩展控制的UI或内容脚本视图 | 窄诊断协议，无完整配置经页面事件传递 |
| 分享编辑器及渲染依赖 | 明确选择本地可打包方案后锁版本 | 离线可加载、字体/图片就绪、导出一致 |
| locale与词典 | manifest目录和业务词典分别生成 | key完整、参数一致、切语言刷新控件 |

旧分享实现有内联Vditor代码，却仍请求`/vditor/dist/index.js`和`/vditor/dist/js/lute/lute.min.js`，原包缺这些资源。新编辑器选型在截图分享批次确定，复用Vditor时必须补齐真实加载依赖和版本，不照抄失效资源声明。原`feedback-*.png`缺失也不能解释成已经证明历史构建内联。

## 5. 权限归属

| 能力 | 实施时核定的权限或入口 |
| --- | --- |
| 配置和仓库 | storage |
| 当前页面检查/截图 | activeTab及实际API所需的页面授权 |
| 自动站点翻译与后台请求 | 按内容脚本及provider需要声明host范围，允许用户授权可选host |
| 右键菜单 | contextMenus |
| 下载 | downloads |
| 浏览器朗读 | tts |
| 标签页信息/跨tab操作 | 按所用tabs方法和敏感字段核定tabs需求 |

Chrome API最小权限以对应实施批次的官方接口核对和实际浏览器验证为准。本表给出责任分配，不把旧包全站host和management权限照搬为新要求。当前骨架权限可由`wxt.config.ts`直接查看。

## 6. 构建与验收

使用现有WXT构建链及锁文件，项目npm源固定官方源。Node最低版本22.12，推荐24。`npm run check`覆盖类型检查、生产构建和manifest入口资源。每个按需注入、编辑器、字体或worker资源还需浏览器加载检查。

验收包含两套本地化入口、已知语言缺key、未知语言、含点完整key、缺参数、切配置更新、字幕与页面语言差异、注入失败重试、分享资源离线加载、样式不干扰宿主、构建产物无业务密钥或旧扩展身份。仅存在词典文案的功能须等实现后才显示。
