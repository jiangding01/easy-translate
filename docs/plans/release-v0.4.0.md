# 发版 v0.4.0 方案

> 状态：发版 PR `#PR` 已合并；`v0.4.0` 标签经用户确认后推送（第 2 步）。「本版要点」与版本号 2026-11-20 用户确认。依据：2026-11-19 用户确认的发版节奏（主题批次收尾后发 0.x，M3b 收尾后发 v0.4.0）；做法沿用 `docs/plans/release-v0.3.0.md`（发版工作流 `.github/workflows/release.yml` 已就绪，本次不改）。

## 现状（2026-11-20，main `0c34bd5`）
- `package.json` / `package-lock.json` 版本 `0.3.0`；已有 `v0.3.0` 标签与 GitHub Release。
- CHANGELOG `[未发布]` 含 M3b 全部（PR1 #61、PR2 #62、PR3 #63、PR4 #64、PR5 #66、PR6 #67），以及 #65（测试修复，无用户可见变化）。
- 版本号取 **0.4.0**：新增用户可见功能（按住翻译段落）与设置项；配置只追加字段 `page.holdKey`（旧配置自动补默认值，不升 schemaVersion），无破坏性改动；仍保持 0.x。

## 第 1 步：发版 PR（分支 `chore/release-v0.4.0`，沿用 `chore/` 命名）
1. **版本号**：`npm version 0.4.0 --no-git-tag-version`，只改 `package.json` 与 `package-lock.json` 的版本字段。
2. **CHANGELOG**：`[未发布]` 改名为 `[0.4.0] - 2026-11-20`，其上新增空的 `[未发布]`；`[0.4.0]` 下最上方加「本版要点」（下方，用户已确认）；底部链接改为 `[未发布]: …/compare/v0.4.0...HEAD`、新增 `[0.4.0]: …/compare/v0.3.0...v0.4.0`。
3. **README 双语**：安装示例文件名改为 `Islet-Translate-v0.4.0-chrome.zip`；路线图新增「✅ 已完成 | v0.4.0（GitHub Release）」，「M3b 段落级交互」改为已完成。
4. **HANDOFF**：阶段摘要与路线图写成发版后的终态（v0.4.0 已发布，M3b 全部完成，下一步按路线图 M3c 指令台与灵岛键盘）；进度表加一行。按约定文档在本 PR 写成终态。
5. **本方案**补实施记录。

## 第 2 步：合并后打标签发版（每一步都需用户确认）
1. 确认 `main` 上发版 PR 合并提交的 CI 全绿。
2. **经用户确认后**：`git tag -a v0.4.0 -m "v0.4.0"`，`git push origin v0.4.0`。
3. 发版工作流跑完后读回 Release：下载 zip，核对 `manifest.json` 版本为 0.4.0、SHA-256 与校验文件一致、发布说明即 `[0.4.0]` 一节。
4. 建议用户用下载的 zip 在 Chrome 里加载一次，整页翻译一个页面，并试一次按住 Ctrl 译段。

## 本版要点（2026-11-20 用户确认）
- 按住翻译段落：指针停在段落上按住 Ctrl（macOS 为 ⌃）约 0.6 秒，只翻译这一段；再按住还原。不必开整页翻译，之后点「翻译此页」，已译的段会沿用。
- 整页翻译中，同样的手势可以把某段还原为原文并不再翻译，或立即翻译还没轮到的段、重试失败的段。
- 设置页可把按键改为 Alt（macOS 为 ⌥ Option），或关闭这个手势。
- 导航条、标签、带省略号的标题等单行界面不再被追加译文挤乱或截掉；只含代码或数字的段落不再白发请求。
- 译文里不再混入段首段尾的装饰符号（•、›、▸ 等）。

## 不做
- 改发版工作流；上架应用商店。

## 验证
- `npm run check`；`npm run zip` 后检查 zip 内 `manifest.json` 版本为 0.4.0。
- 本地用 bash 跑一遍工作流里的三项校验（标签与版本一致、CHANGELOG 有 `## [0.4.0]`、发布说明截取）。
- check 的发版审查（版本号与 CHANGELOG 一致性）。

## 风险与回滚
- 标签推送与 Release 是公开操作：有误可删除 Release 与标签后修复再发（删除前先问用户）；发版 PR 可 revert。

## 实施记录（2026-11-20）
- 版本号：`npm version 0.4.0 --no-git-tag-version`，`package.json` 与 `package-lock.json` 只改版本字段（3 处）。
- CHANGELOG：`[未发布]` 归入 `[0.4.0] - 2026-11-20`，其上新增空的 `[未发布]`，加 5 条本版要点；底部链接改为 `compare/v0.4.0...HEAD` 并新增 `[0.4.0]: …/compare/v0.3.0...v0.4.0`。
- README 双语：安装示例改为 `Islet-Translate-v0.4.0-chrome.zip`；路线图 M3b 与 v0.4.0 标为已完成。HANDOFF 按终态更新，下一步 M3c。
- 本地验证（2026-11-20）：`npm run check` 通过（80 个文件、1788 个单测，Size check passed）；`npm run zip` 生成 `Islet-Translate-v0.4.0-chrome.zip`，包内 `manifest.json` 版本为 0.4.0。
- 待办（第 2 步，需用户确认）：合并后确认 main 上 CI 全绿，再推送 `v0.4.0` 标签，读回 Release 核对。
