# Easy Translate

基于椰子翻译安装包重新搭建的 Chrome 网页翻译扩展工程。技术栈为 WXT、React、TypeScript，目标为 Manifest V3。

当前为开发骨架：包含弹窗、设置页、后台 Service Worker、Content Script、类型化消息和本地设置存储。**尚未接入翻译服务，不会生成译文，也不会向旧插件服务器发送内容。**

## 开始开发

需要 Node.js 22.12 或更新版本及 npm，`.nvmrc` 推荐 Node.js 24。使用 nvm 时可先执行 `nvm use`。项目 `.npmrc` 固定使用 npm 官方源 `https://registry.npmjs.org/`，并清空项目作用域内的官方源令牌。

```sh
npm ci
npm run dev
```

开发模式不会自动打开浏览器。打开 `chrome://extensions`，启用「开发者模式」，点击「加载已解压的扩展程序」，选择本项目的 `.output/chrome-mv3-dev`。

WXT 监听源码变化并更新开发产物；修改 manifest 或后台逻辑后，如没有自动生效，在扩展管理页点击重新加载。重新加载扩展后，请刷新用于调试的网页。

## 构建与检查

```sh
npm run typecheck  # TypeScript 严格检查
npm run check      # 类型检查、生产构建、manifest 及入口文件校验
npm run build      # 生产构建：.output/chrome-mv3
npm run zip        # 生成可分发 ZIP，位于 .output
```

正式本地体验时，加载 `.output/chrome-mv3`。ZIP 是打包产物，商店发布还需要后续准备。

## 目录

```text
src/
  entrypoints/
    background.ts       # 后台 Service Worker，后续承载翻译服务调用
    content.ts          # 页面入口，后续承载提取、渲染与还原
    popup/              # 工具栏弹窗
    options/            # 设置页
  components/           # 共享 React 组件
  lib/
    messages.ts         # 消息协议与当前页面检查
    settings.ts         # 设置类型、默认值及 storage.local 读写
  styles/               # CSS Modules
public/icon/            # 从旧包复用的图标
scripts/check-build.mjs # 构建产物校验
docs/                  # 旧插件功能文档、架构图与重构路线
wxt.config.ts          # Manifest 配置，入口项由 WXT 生成
```

## 手动验收

1. 加载扩展，在普通 HTTP/HTTPS 页面中打开弹窗。
2. 点击「检查当前页面」，应显示页面标题、HTML 声明的语言及通信成功提示。
3. 打开「翻译设置」，修改目标语言和显示模式，保存后重新打开弹窗，确认设置保留。
4. 在 `chrome://extensions` 等受限页面中检查，应显示可理解的提示。
5. 在扩展管理页检查 Service Worker 和弹窗，确认没有未处理的运行错误。

页面检查只读取标题和 HTML 的 `lang`，不是语言自动识别。Chrome 内部页、Chrome 网上应用店、PDF 阅读器等受限页面不能注入脚本；已有网页在安装或重载扩展后需刷新。

## 后续迁移

旧包逆向与重构方案从 [docs/README.md](docs/README.md) 开始。模块文档涵盖调用链、关键旧代码、协议、缺口和分批验收。

旧安装包、源码摘录、分析快照和工具结果保存在本地 `evidence/legacy/`。Git 忽略整个 `evidence/` 目录。需要查看证据链接或运行 `node scripts/reverse-engineering/validate.mjs` 时，请先把完整的 `evidence/` 资料放到项目根目录。日常安装依赖、开发和构建可直接使用仓库中的文件。

先接入一个明确的翻译服务，再实现文本提取、双语对照/替换原文、恢复原文及动态页面处理。当前设置会保存，但需要翻译管线接入后才影响译文。

不要把服务密钥写入源码、`public` 或前端环境变量。浏览器扩展产物对用户可见，`.env` 不会使打包后的密钥保密。

框架入口与 manifest 生成方式参考 [WXT 官方文档](https://wxt.dev/guide/essentials/entrypoints)。
