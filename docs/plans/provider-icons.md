# 引擎供应商图标

> 2026-11-17 · 状态：**已合并**（PR #14），用户真机验收通过

## 1. 目标

所有选择或展示翻译引擎的地方，把字母缩写（G、DS、AI、Ge）换成供应商图标：

- 内置引擎：Google、OpenAI、DeepSeek、Gemini。
- 自定义服务预设：Ollama、LM Studio、OpenRouter、硅基流动（按接口地址识别）。
- 其余自定义服务：首字小方块兜底（取名称前两个字，`customShort`）。

展示位置共 5 处：
1. 划词卡片顶部的引擎按钮
2. 卡片的引擎列表
3. 灵岛的引擎按钮和列表
4. 工具栏面板底栏的引擎下拉
5. 设置页的服务列表

## 2. 不做

- 不给「其他」类自定义服务配图标，也不支持上传图标。
- 不改配置结构、不新增权限、不新增 web accessible resource。
- 设置页「添加服务」对话框里的预设单选项暂不加图标（不在上述 5 处之内）。

## 3. 设计

| 决定 | 理由 |
|---|---|
| 图标存成路径数据（`src/lib/provider-icons.ts`：`viewBox` + 若干路径的 `d`、`fill`、`opacity`、`evenOdd`），不存 SVG 文本 | 内容侧用 `createElementNS` 逐条画出，React 侧用 `<path>` 渲染。两边都不解析文本，不用 `innerHTML` 或 `dangerouslySetInnerHTML` |
| 单色图标不写 `fill`，渲染为 `currentColor` | 跟随文字颜色，深色卡片上显示为浅色 |
| Gemini 去掉原图的三层渐变，改为纯色 `#3186FF` | 渐变需要 `<defs>` 和 id，同一个 Shadow DOM 里画两次会出现重复 id；16px 下看不出区别 |
| 卡片和灵岛的图标由后台随 `engine.options` 下发（`EngineOption.icon`） | 划词模块只剩约 1KB 余量。图标数据只打进后台，两个按需模块只增加绘制代码（`src/content/svg-icon.ts`） |
| 面板和设置页直接引用 `provider-icons.ts`（`src/components/ProviderIcon.tsx`） | 这两处体积余量充足 |
| 自定义服务按接口地址识别预设：本机 11434 端口 → Ollama，本机 1234 端口 → LM Studio，`openrouter.ai` → OpenRouter，`api.siliconflow.cn` / `.com` → 硅基流动 | 配置里没有记录服务来自哪个预设，按地址识别不用迁移数据。认不出时退回首字，不影响功能 |
| `customShort` 放在 `src/lib/engine-view.ts` | 前后台共用；`src/lib/translate/` 只给后台使用 |

图标来源：[lobe-icons](https://github.com/lobehub/lobe-icons) 1.102.0（MIT），出处写在 `provider-icons.ts` 文件头。图标只用来标明是哪家服务，不改形状和颜色（Gemini 的简化除外）。

## 4. 体积（gzip，`check-size` 口径）

| 入口 | 前 | 后 | 预算 |
|---|---|---|---|
| content | 6.99 | 6.99 | 7 |
| page-runtime | 21.86 | 22.05 | 24 |
| selection-runtime | 17.06 | 17.27 | 18 |
| background | 49.08 | 54.23 | 60 |
| popup | 79.74 | 84.48 | 90 |
| options | 86.21 | 90.96 | 150 |

## 5. 验收

- 单元测试覆盖：
  - 识别规则：四个内置引擎；四种预设地址（`localhost` 和 `127.0.0.1` 都测）；端口不对、陌生域名、空地址、非法地址都返回空。
  - 数据完整性。
  - 后台下发的列表里带有 `icon`。
  - 绘制函数。
  - 卡片和灵岛：有图标、无图标两种显示；切换引擎后图标随之更新；无障碍名称不变。
  - `Select` 组件带图标的选项。
  - `customShort`。
- 真机：用户在浅色和深色下逐一检查了 5 处，都没有问题。单色图标在深色卡片上能看清；不可用引擎的那一行图标半透明。
