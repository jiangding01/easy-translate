# 插件端逆向资料全面复核报告

[返回总索引](README.md) · [准确性与覆盖边界](plugin-coverage-status.md)

本文保留首轮全面复核的范围和结果；后续DeepSeek对照的新增修正以[交叉核验报告](deepseek-cross-validation.md)为准，当前模块索引已扩至13份。

## 结论

本轮完成12份模块文档的逐章节复核，并交叉检查入口、路线图、覆盖说明、证据说明和资料工具。发现并修正了实际错误、遗漏及过度概括；不能沿用初稿中较强的“取消”“完成”“上限”“优先级”等保证。

本次更正的是重构参考资料，没有开始新插件功能实现，没有修改旧原包、排版副本或旧代码摘录。真实浏览器/站点运行尚未全量验证，因此结论是“本轮发现均已处理、资料更准确且可追溯”，不是逐分支100%或无剩余未知的证明。

## 1. 审查范围与分工

| 范围 | 执行与验收 | 逐项记录 |
| --- | --- | --- |
| 01服务、07账户客户端、08专家术语 | GPT-6.1 Terra静态核查与修订，主代理检查修订/调用方及跨文档一致性 | [services-review.md](../evidence/legacy/audit/services-review.md)，8项记录 |
| 02页面、03交互、04截图分享 | GPT-6.1 Terra静态核查与修订，主代理验收边界与引用 | [page-review.md](../evidence/legacy/audit/page-review.md)，9项记录 |
| 05字幕、05a阅读、05b TikTok | GPT-6.1 Terra静态核查、既有探针审查和新反例，主代理验收 | [video-review.md](../evidence/legacy/audit/video-review.md)，11项记录 |
| 00架构、06设置、09平台、索引/路线图/证据与工具 | 主代理核查、协调、修订和最终验证；工具编写交给Terra后验收 | [platform-review.md](../evidence/legacy/audit/platform-review.md) |

这些是审查记录项数，包含跨文档同步与行为限定，不能简单相加当作独立程序缺陷数量。此次使用3个Terra子代理并复用完成后的代理补充小任务；没有重复REA整包、联网核实旧服务或新增项目依赖。未提供精确费用统计，不据此声称节约了某个金额或比例。

## 2. 影响后续实现的主要纠正

| 原表述/遗漏 | 核对后的结论 | 已同步模块 |
| --- | --- | --- |
| 划词序号可阻止全部旧结果 | 仅成功路径比较序号，旧失败可覆盖新结果；关闭后在途请求也可重新显示窗口 | 03 |
| 悬停abort保护在途翻译/回填 | 调用hf未传signal；循环的取消不代表请求与回填被取消 | 03 |
| completed代表全部译完 | 懒加载/SPA有先标completed的路径，异常路径也可能设置completed | 02 |
| 截图各单边和总像素有硬上限 | 高度计算有限制，宽度未夹取，极端尺寸不能据此保证 | 04 |
| 截图统一隐藏浮球、分享导出可靠成功 | 两条截图入口回调不同；分享未检查下载返回success，截图路径则检查 | 04 |
| YouTube始终ASR优先 | 先非CC组再全部轨，各组内ASR优先；非CC人工轨可胜过CC自动轨 | 05 |
| 播放器fallback始终校验ID/token继续回退 | HTML回退未同样核ID；匹配音轨缺token时也可能直接返回 | 05 |
| 阅读文章所有失败统一重试 | 抛异常、登录错误、普通错误/校验失败的分支不同 | 05a |
| 配置里的temperature传入普通AI任务 | 普通AI任务构造即丢弃该参数；Coco保留 | 01 |
| 服务测试无副作用或只有一种入口 | Kp先保存配置且无失败/取消回滚；Ky有另一条测试和不同UI可见条件 | 01、06 |
| 专家存储修改自动同步所有消费副本 | Prompt消费副本缓存未见对应watch，不能套用管理UI的watch保证 | 00、01、08 |
| CacheService有内存译文front cache | 实际译文读写IndexedDB，只有连接/初始化和计数等内存状态 | 00 |
| 冲突扩展操作success表示真实API成功 | 底层吞错，上层仍可返回成功、写管理标记或删原状态 | 09 |

完整的小边界还包括U+200B清理范围、Coco重试计数作用域、401分支优先级、术语词条没有库的时间戳、CSV缺列与空字符串不同、字幕时长60秒开区间、注入失败标记清理、TikTok程序滚动和标签页查找。详见专项记录及各模块原代码引用。

## 3. 新增验证与可复查材料

| 验证 | 范围与意义 | 结果文件 |
| --- | --- | --- |
| 原始/排版JS语法树指纹 | 20文件；忽略位置/注释/部分冗余括号，保留操作符和字面量等；不是运行等价证明 | [format-equivalence.json](../evidence/legacy/audit/format-equivalence.json) |
| 检查器正反例自检 | 接受空白/分号排版；拒绝数字、声明类型、一元操作符、可选链边界和指令变异 | 同上selfCheck |
| 原14项视频探针 | 重新审查每项断言和stub的真实覆盖，不能推广为整个链路正确 | [probe-results.json](../evidence/legacy/extracts/video/probe-results.json) |
| 2项视频对抗案例 | 非CC人工轨胜过CC自动轨；匹配音轨无token不继续观察URL回退 | [adversarial-results.json](../evidence/legacy/audit/video/adversarial-results.json) |
| 3项平台案例 | 检查不禁用；API拒绝时禁用仍success；恢复失败仍清状态 | [platform/probe-results.json](../evidence/legacy/audit/platform/probe-results.json) |
| 资料一致性 | 原始/排版hash、180个摘录范围、完整供应商摘录、文档链接/源行号、12模块索引、REA压缩证据 | [validation-report.json](../evidence/legacy/validation-report.json) |
| 校验器负例回归 | 临时副本注入无来源代码：旧校验器误通过，新校验器拒绝并写failed；干净副本仍通过，原材料未改 | [validator-self-test.json](../evidence/legacy/audit/validator-self-test.json) |

初稿和起始文件哈希保存在 [baseline/](../evidence/legacy/audit/baseline/) 与 [baseline-manifest.json](../evidence/legacy/audit/baseline-manifest.json)。[冻结范围修改清单](../evidence/legacy/audit/change-inventory.json) 和 [对应文档/工具补丁](../evidence/legacy/audit/document-changes.patch) 便于检查本次到底改了哪些判断；17份运行源码/配置文件与起始哈希一致。新审查材料另保留在audit目录；证据目录README也更新了复查命令，但不在这份初稿补丁的冻结范围内。

## 4. 后续使用限制

- 原行为、已确认缺陷、静态推导和新设计建议在模块内分开；实现时不能把验收目标误读为旧插件已有保证。
- 现有探针是选定声明加stub，没有启动完整旧插件，不能证明DOM、权限、播放器私有API、广告/SPA时序和线上服务有效。
- REA自动调用图仍为部分覆盖；本轮没有通过放宽限制或重复运行把它包装为完整图。
- 缺少vditor本地资源的问题仍存在于旧快照，未用猜测补造文件。
- 本轮发现均已修订；仍有明确的运行验证边界，因此不签发“绝无遗漏、绝无错误”的绝对保证。

复查命令与证据分类见 [证据说明](evidence-and-validation.md) 和 [证据目录](../evidence/legacy/README.md)。
