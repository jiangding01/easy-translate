# 缓存过期清扫与如实报错方案（Codex 第 5 条）

> 状态：已合并（#50，2026-11-18）。2026-11-18 用户批准，新增文案已确认。方案经 Opus 对抗式审查后修订。来源：`docs/reviews/2026-11-18-codex-review-verification.md` 第 5 条（P3）。

## 问题
1. **「保留 7 天」与实际不符**：过期判定用 `createdAt`（`cache.ts:145, 164`），但只在读到该键时删除（`read` → `removeExpired`，`:139-170`）。从未再读的冷数据会一直占着磁盘，直到总量超过 100 MiB 才按最近使用时间淘汰（`:177-218`）。这是原设计「读取时检查，过期即删除」（`m1-translation-core.md:143`）留下的落差。
2. **清空失败仍提示成功**：`clear()` 被 `guarded` 包住（`:308-314`），数据库打开或删除失败时只 `console.warn` 并返回 `undefined`，设置页照常显示「已清空缓存」（`CacheSection.tsx:47-48`）。
3. **同类：统计失败**：`stats()` 同样被 `guarded` 吞成 `{count:0,totalBytes:0}`（`:293-306`），设置页显示「暂无缓存」；若改成如实失败，现有界面又会一直停在「正在统计…」（`CacheSection.tsx:32` 只处理成功）。

## 方案（`cache.ts`、`CacheSection.tsx` 与其显示函数）
1. **过期清扫 `sweepExpired()`，按 `createdAt` 全表分批扫描**：用主键游标 `lowerBound(lastKey, true)` 分批续扫，每批最多 500 条，删除 `createdAt < now - ttl` 的记录，并在同一 readwrite 事务里扣减 `meta.totalBytes`；结构照搬 `evictBatch`，但单独写 `sweepBatch`，不改 `evictBatch` 的签名（`cache.test.ts:172` 依赖它的事务数）。不用 `lastUsedAt` 索引：近 7 天内被读过一次、之后再没读到的记录要等到约第 14 天才会被它扫到（审查指出），与「保留 7 天」不符。全表扫描不需要新索引、不升 DB 版本、无数据迁移。
2. **触发**：在缓存内部，本次 SW 生命周期**第一次 `put` 完成之后**顺带触发（与现有「写入后按需淘汰」同一位置），不改 `background.ts`、不在 SW 被 `page.status` 等高频消息唤醒时打开数据库，也不拖慢首个 `getMany`。用 `meta` 里新增的 `sweptAt` 节流为每 24 小时最多一次；`sweptAt` 在**清扫完成后**才写入（SW 可能中途被回收，没扫完就下次再扫）；`sweptAt > now`（时钟回拨）视为到期。失败沿用降级：记警告，下次再试。不加 `alarms` 权限。
3. **统一的失败处理**：把 `guarded` 里「失败时丢弃连接」的逻辑抽成 `run(task)`（失败丢弃连接后重新抛出），`guarded = run + 回退值`。`getMany` / `put` / `touch` / 淘汰仍走 `guarded`，行为不变（缓存坏了照常翻译，`m1-translation-core.md:146`）。
4. **清空如实报错**：`clear()` 改走 `run`，失败抛 `appError('internal', 'internal/cache-unavailable', …)`。错误经 `admin.ts` 的 `wrap` / `handle` 变成 `{ ok:false }`；`internal/cache-unavailable` 不在错误文案表里，设置页按现有写法回落到「清空失败，请重试。」（`errors.action.clearFailed`）。不新增清空相关文案、不加错误码映射。
5. **统计如实报错**：`stats()` 改走 `run`，失败抛同一错误。`CacheSection` 新增「统计失败」状态：把显示逻辑放进纯函数（扩展现有 `cacheSummary` 接受 `'failed'`），显示新增文案（见下）；「清空」按钮在统计失败时仍可点（清空可能修复损坏的库），清空成功后显示正常统计。
6. 不改：阈值常量、「保留 7 天」文案（每天清扫一次后，过期记录最迟约一天内被删除；超过 7 天的记录本来就不会被返回）。

## 新增文案（需用户确认）
| key | en | zh_CN | zh_TW |
|---|---|---|---|
| `options.cache.unavailable` | Couldn't read the cache | 暂时无法读取缓存 | 暫時無法讀取快取 |

## 测试
- `cache.test.ts`（fake-indexeddb，注入 `now`）：
  - 冷记录过期后被清扫；「7 天内被读过一次、之后不再读」的记录在创建满 7 天后的清扫中被删（锁定按 `createdAt`）；未过期记录不受影响；
  - 清扫后 `meta.totalBytes` 与剩余记录一致；超过 500 条时分批完成；
  - 24 小时内第二次触发不扫描（第一次清扫后写入冷记录、时间推进不到 24 小时，冷记录仍在）；`sweptAt` 在未来时照常清扫；清扫中途失败不写 `sweptAt`；
  - 本次生命周期的第一次 `put` 之后才触发，`getMany` 不触发；
  - `clear()` 在打开失败与事务失败时都抛错，之后能恢复（`opened - closed === 1`，参照 `:259`）；`stats()` 同样；扩展 `instrumented()` 让只读事务也能注入失败；
  - 现有 `:93`「打开失败时 stats 返回 {0,0}」改为断言抛错。
- `admin.test.ts`：`cache.clear` / `cache.stats` 在缓存抛错时返回 `{ ok:false }`。
- `copy.test.ts`：`cacheSummary('failed')` 返回 unavailable 文案。
- 变异验证：清扫改用 `lastUsedAt` 判定 →「读过一次后不再读」用例变红；`clear()` 恢复吞错 → 抛错用例变红；去掉节流 →「24 小时内不重扫」变红；清扫不扣 `totalBytes` → 一致性用例变红。
- e2e：`support.ts` 的 `cache.clear` 断言 `ok:true` 不受影响；全套 `--retry=0` 连跑 2 次。
- 手工：临时让 `stats` / `clear` 抛错，看设置页显示。
- 命令：`npm run lint`、`tsc --noEmit`、`npm test`、`npm run build`、`node scripts/check-size.mjs`（background 57.13 / 60 KB、options 89.10 / 150 KB）。

## 文档
本方案（落地后补实施记录）；`m1-translation-core.md:143`（补「后台每天按创建时间清扫一次过期记录」）与 `:146`（清空、统计失败如实报告，其余操作仍降级）；核实记录第 5 条状态；CHANGELOG；HANDOFF。

## 回滚
revert 本 PR；`meta` 里多出的 `sweptAt` 不影响旧代码（旧代码只读 `totalBytes`），数据库版本不变。

## 分支
`fix/cache-honesty`

## 已知限制
- 清扫每次从头扫起，不记续扫位置。缓存极大时若 SW 中途被回收，下次会从头再扫，可能长期扫不完；此时仍由 100 MiB 的 LRU 淘汰兜底。需要时可加续扫位置。
- 设置页「暂时无法读取缓存」状态只有单测覆盖，需手工查看。

## 实施记录（2026-11-18）
- 实现：`cache.ts` 抽出 `run(task)`（失败丢弃连接后重新抛出），`guarded = run + 降级`；`clear` / `stats` 改走 `run`，失败抛 `internal/cache-unavailable`。新增 `sweepExpired`：按 `createdAt` 全表分批（主键游标续扫，每批不超过 500 条）清扫过期记录，同事务扣减 `meta.totalBytes`；本次 SW 生命周期第一次 `put` 之后触发一次检查，24 小时节流，`sweptAt` 在未来视为到期，失败只记警告。缓存写入在 scheduler 里是后台排队、不被等待（`scheduler.ts:659`），清扫不拖慢翻译。设置页 `CacheSection` 统计失败显示新文案 `options.cache.unavailable`（Couldn't read the cache / 暂时无法读取缓存 / 暫時無法讀取快取），清空按钮仍可点；清空失败沿用「清空失败，请重试。」。不改 `background.ts`、权限与 DB 版本；`meta` 多出 `sweptAt` 键，旧代码不读它。
- 与方案的差异：`sweptAt` 在最后一批清扫的同一事务里写入（完成才写，原子），不是清扫结束后另开事务；首次清扫失败后，本次 SW 生命周期不再重试，下次唤醒再试。
- 测试：`cache.test.ts` 新增 11 条（清扫 8 条，clear / stats 打开失败与事务失败），原「打开失败时 stats 返回 {0,0}」改为断言抛错，`instrumented()` 支持只读事务注入失败；`admin.test.ts` 1 条；`copy.test.ts` 1 条；`port-host.test.ts` 桩补 `sweepExpired`。
- 变异验证：四组均变红（清扫改用 `lastUsedAt`、`clear` / `stats` 恢复吞错、去掉节流、不扣 `totalBytes`）。
- 体积：background 57.13 KB 增至 57.52 KB，options 89.10 KB 增至 89.32 KB。
- 验证：lint、tsc、`check:i18n`、`npm test`（1550 个用例）、build 通过；e2e `--retry=0` 连跑 2 次，34 通过、2 跳过。
- check：第 1 轮无阻断问题；建议项（清扫每次从头扫）记为上面的已知限制。
