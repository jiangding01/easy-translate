# 发版 v0.2.0 方案

> 状态：已实施（发版 PR #53 与 v0.2.0 标签）。依据：`HANDOFF.md` 路线图第 7 项（2026-11-17 用户确认：先不上架商店，只发 GitHub Release；同时加发版工作流）。

## 现状（2026-11-18，main `247dd02`）
- 仓库**从未打过 tag、没有 GitHub Release**；`package.json` 与 `package-lock.json` 为 `0.1.0`，CHANGELOG 有 `[0.1.0] - 2026-11-08` 一节（底部链接指向提交 `51cdccd`）和很长的 `[未发布]` 一节。
- CI（`ci.yml`）在 PR 与 main 推送上跑 check、dependency-review、e2e；CodeQL 单独工作流；`main protection` 规则集要求 check、dependency-review、analyze 通过。
- 打包命令已有：`npm run zip`（`wxt zip --browser chrome`）。
- README 安装说明目前只有「从 CI 构建下载」和「从源码构建」两种。

## 方案：两步
### 第 1 步：发版 PR（分支 `chore/release-v0.2.0`）
1. **版本号**：`package.json` 与 `package-lock.json` 根版本改为 `0.2.0`（`npm version 0.2.0 --no-git-tag-version`，不打 tag）。
2. **CHANGELOG**：`[未发布]` 改名为 `[0.2.0] - 2026-11-18`，其上新增空的 `[未发布]`；底部链接改为 `[未发布]: …/compare/v0.2.0...HEAD`、`[0.2.0]: …/compare/51cdccd...v0.2.0`（0.1.0 从未打 tag，沿用提交链接）。
3. **发版工作流 `.github/workflows/release.yml`**（推送 `v*` 标签时运行）：
   - 权限只给 `contents: write`；action 与 `ci.yml` 一样钉版本；`persist-credentials: false`；超时 15 分钟。
   - 校验：标签 `vX.Y.Z` 必须等于 `package.json` 的版本；CHANGELOG 必须有 `## [X.Y.Z]` 一节；标签指向的提交必须已在 `main` 上（`git merge-base --is-ancestor`），防止从分支发版。
   - `npm ci` → `npm run check`（完整检查，含 check:build 与 check:size）→ `npm run zip`。
   - 从 CHANGELOG 截取 `## [X.Y.Z]` 到下一个 `## [` 之间的内容作为发布说明。
   - `gh release create vX.Y.Z <zip> --title "vX.Y.Z" --notes-file <截取内容>`；同时附上 zip 的 SHA-256 校验文件。
   - e2e 不在发版工作流里重跑：标签必须指向 `main` 上的提交，而该提交的 CI（含 e2e）在合并时已经跑过；发版前我会确认该提交的 CI 全绿。
4. **README 双语**：安装一节新增第一种方式「从 GitHub Release 下载」（下载 zip、解压、开发者模式加载已解压的扩展程序），原有两种保留。
5. **文档**：HANDOFF 路线图第 7 项与阶段摘要写成发版后的终态（v0.2.0 已发布，下一步 e2e 设为必过与 M3d）；本方案补实施记录。按约定，文档在本 PR 里直接写成终态。

### 第 2 步：合并后打标签发版（每一步都需你确认）
1. 确认 `main` 上发版 PR 合并提交的 CI 全绿。
2. **经你确认后**推送标签：`git tag -a v0.2.0 -m "v0.2.0"` 并 `git push origin v0.2.0`。
3. 等发版工作流跑完，读回 Release：下载附件 zip，核对其中 `manifest.json` 的 `version` 为 `0.2.0`、文件清单与本地 `npm run zip` 一致、SHA-256 与校验文件一致。
4. 在 Chrome 里用下载的 zip 加载一次，确认能整页翻译（建议你亲自点一遍）。

## 发布说明（用户 2026-11-18 选定）
在 `[0.2.0]` 一节最上方加 5 到 8 行「本版要点」（面向用户），其余逐条记录保持原样，发布说明就是整节内容。

## 不做
- 上架 Chrome 应用商店（等你决定上架时再准备图标、隐私政策、商店截图）。
- 补打 `v0.1.0` 标签（从未发布过，补打没有意义）。
- 在发版工作流里重跑 e2e（理由见上）。

## 风险与回滚
- 发版工作流属于发布类改动，需要你在 PR 上亲自过目。
- 标签推送与 Release 创建是公开操作：若 Release 有误，可删除 Release 与标签后修复再发（删除前会先问你）；版本号与 CHANGELOG 的改动可 revert 发版 PR。

## 验证
- 本地：`npm run check`；`npm run zip` 后检查 zip 内 `manifest.json` 版本为 0.2.0。
- 工作流：用 `actionlint`（若本机可用）检查语法；脚本中的版本校验与 CHANGELOG 截取逻辑在本地用 bash 跑一遍。
- 发版后：按第 2 步第 3、4 条读回核对。

## 实施记录（2026-11-18）
- 版本号：`npm version 0.2.0 --no-git-tag-version`，`package.json` 与 `package-lock.json` 只改了版本字段（共 3 处，无依赖变动）。
- CHANGELOG：`[未发布]` 归入 `[0.2.0] - 2026-11-18`，其上新增空的 `[未发布]`，`[0.2.0]` 下新增 8 条面向用户的「本版要点」；底部链接按方案更新，保留 `[0.1.0]`。
- `.github/workflows/release.yml`：沿用 `ci.yml` 的 `actions/checkout@v7`、`actions/setup-node@v7`、`.nvmrc`；`fetch-depth: 0`、`persist-credentials: false`、job 级 `contents: write`、`timeout-minutes: 15`、按标签的 concurrency；校验标签与 `package.json`、CHANGELOG 小节、提交在 `origin/main` 上；`npm ci` → `npm run check` → `npm run zip`；生成 `.sha256`，用 awk 截取 CHANGELOG 小节为发布说明；`gh release create ... --verify-tag`，不使用第三方 release action。
- README 双语：安装一节新增「从 GitHub Release 下载」（含可选 SHA-256 校验），路线图 v0.2.0 项改为已完成。HANDOFF 按终态更新。
- 本地验证：本机没有 actionlint，只用 Python 解析 YAML 确认语法；在本地用 bash 模拟了三项校验（版本一致、CHANGELOG 小节存在、`HEAD` 是 `origin/main` 的祖先）与发布说明截取，均通过。`npm run zip` 产物为 `.output/Islet-Translate-v0.2.0-chrome.zip`，其 `manifest.json` 版本为 0.2.0。`npm run check` 结果见 PR 说明。
- 待办（第 2 步，需用户确认）：合并后确认 main 上 CI 全绿，再推送 `v0.2.0` 标签，读回 Release 核对。
