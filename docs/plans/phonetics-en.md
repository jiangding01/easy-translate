# 划词卡片显示英文单词音标

> 2026-11-17 · 状态：已实现，用户真机验收通过（分支 `feat/phonetics-en`）

## 1. 目标

划词卡片选中单个英文单词、且目标语言不是英文时，在原文行单词后显示英式 IPA 音标（如 `different /ˈdɪfrənt/`）。词形变化通过规则还原到词头时显示 `lemma /ipa/`。音标数据随扩展打包，查询不联网。

## 2. 数据

数据源：[ECDICT](https://github.com/skywind3000/ECDICT)，commit `39cfb9672c0906b63569e0453c2e6abfb9ab182a`，MIT，Copyright (c) 2025 Linwei。

- 生成脚本 `scripts/build-phonetics.mjs`（Node，不引入 Python），参数为本地 `ecdict.csv` 路径，输出 `public/dict/en-phonetic.tsv`，构建时不联网。
- 选词用「词形扩展法」：词头的 `min(frq,bnc)` 有效排名传给 `exchange` 中的变形（变形自身排名更靠前则用自身），取前 30000。
  - 只收纯字母词（小写 key）；全大写缩写仅保留有排名的；首字母大写有排名的保留并转小写。
  - 排除含空格、数字、连字符的条目；撇号条目只保留 `o'clock`、`ma'am`、`y'all`。
  - 手工补词：`are`（`/ɑː/`，按 ECDICT 风格先给 ASCII 再转换）、`python` 及调研列出的少量高频技术词（`callback`、`asynchronous`、`indentation`、`whitespace`、`instantiation`，前提是 ECDICT 有音标）。
- 音标清洗：取第一读音（`;` 及「. 」「, 」分隔的备选读音丢弃；注意 `,` 与 `.` 在词内表示次重音）；统一 `ә`(西里尔)→`ə`、`^`→`ɡ`、`є`→`ɛ`、`\`→`ɜ` 等；含方括号 / 中文 / 全角 / `?` 的丢弃。
- 写法转换为现代英式 IPA：规则放 `src/lib/phonetic/notation.ts`（纯函数，生成脚本也 import 它，保证单一来源）。先双元音后单元音：
  - `ei→eɪ`、`ai→aɪ`、`ɔi→ɔɪ`、`au→aʊ`、`əu→əʊ`、`iə→ɪə`、`ɛə/єә→eə`、`uə→ʊə`；
  - `i:→iː`、`u:→uː`、`ɑ:→ɑː`、`ɔ:/ɒ:→ɔː`、`ə:→ɜː`、单独 `i→ɪ`、单独 `u→ʊ`；
  - `'`→`ˈ`，词内 `,` 或 `.`→`ˌ`（次重音），`:`→`ː`。
  - 根据 ECDICT 实际数据补全遗漏规则；`notation.test.ts` 用 ≥20 个真实样例断言（含 `different→ˈdɪfrənt`、`reputed→rɪˈpjuːtɪd`、`concert→ˈkɒnsət`、`withdrawal→wɪðˈdrɔːl`、`abdication→ˌæbdɪˈkeɪʃən`、`wield→wiːld`、`ostrich→ˈɒstrɪtʃ`、`periscope→ˈperɪskəʊp`）。
- TSV 第一行注释 `# ECDICT 39cfb96 · build-phonetics v2`（v1 为首版，v2 加入下述 happY 与 hw 规则），之后每行 `word\tipa`（存转换后的 IPA）。同目录放 `public/dict/ECDICT-LICENSE.txt`。

## 3. 后台

- `src/lib/phonetic/lookup.ts`：首次查询时 `fetch(browser.runtime.getURL('/dict/en-phonetic.tsv'))`，按行 split 建 Map（跳过 `#` 行），内存缓存；加载失败返回 `undefined` 且不缓存失败（下次再试），绝不抛到翻译流程。
  - 规范化：`’`→`'`，小写，去首尾非字母，去结尾 `'s`；必须是 ≤40 字符、纯字母（最多一个内部撇号）才查。
  - 查找顺序：精确命中 → 规则还原（仅词表未命中时）：去 `-s`；去 `-es`；`-ies→y`；`-ied→y`；`-ed` 去掉后试原样、补 `e`、去重复辅音；`-ing` 同理。规则命中时返回 `{ ipa, lemma }`，精确命中返回 `{ ipa }`。
- 协议：`TranslateRequest` 增加 `phonetic?: true`；`TranslateChunk` 增加变体 `{ id: string; phonetic: string; lemma?: string }`。`parseTranslateRequest` 接受该字段；多条 items 时忽略标记、不报错。标记不得进入缓存键或影响调度去重。
- service：收到带标记的单条请求，音标查询与翻译并行（不 await 在翻译之前）；查到就 emit 音标分片（经同一个 emit，受 abort 守卫）；在 resolve done 之前 await 音标查询（保证音标分片早于请求结束），查询失败 / 未命中则不发。后台自己也做单词判定，不信任前端。
- 语言条件：后台不判断语言，由卡片决定是否带标记。

## 4. 卡片（`src/content/selection/`）

- `request.ts`：带标记的条件——选中文本是单个英文单词（同上规则）、目标语言基码不是 `en`、并且（检测语言为 `en`，或检测不可靠 / 为 auto 而页面声明语言 `document.documentElement.lang` 基码为 `en`）。检测到其他语言不带。
- `onChunk`：在判断最终译文的兜底分支之前先识别 `'phonetic' in chunk`；音标分片在请求 outcome 之前都接收，即使最终译文已到（finished）也要显示。新增事件 `{ kind: 'phonetic', ipa, lemma? }`。同时检查 page runtime 等其他 `TranslateChunk` 消费者的类型收窄，避免未来误判。
- 显示：原文行单词后显示 `/ipa/`，规则还原时显示 `lemma /ipa/`；「原文」标签 `white-space:nowrap` 不换行；单词与音标放一个 flex-wrap 容器，音标块 `white-space:nowrap` 整块换行；音标用系统无衬线字体（`system-ui,-apple-system,"Segoe UI",sans-serif`），颜色用次要文字色。重译 / 切换引擎 / 新选区时清掉旧音标。朗读不受影响。
- 体积：selection-runtime gzip 预算 18KB（现 17.27KB），content 必须不变（6.99 / 7KB）。

## 5. 构建检查

- `scripts/check-build.mjs`：断言 `dict/en-phonetic.tsv` 与 `ECDICT-LICENSE.txt` 在产物中存在、首行以 `# ECDICT ` 开头、且不在 `web_accessible_resources` 中。
- `scripts/check-size.mjs`：为数据文件加 gzip 预算 250KB。

## 6. 测试（`src/**/*.test.ts`）

- notation：≥20 个真实样例。
- lookup：精确命中、大小写、`’s` 与 `'s`、规则还原（`changes→change` 不得为 `chang`、`watches→watch`、`studies→study`、`stopped→stop`、`making→make`、`running→run`）、未命中、`are`、`#` 行跳过、加载失败返回 `undefined` 且下次重试、非单词输入不查。用小的内存 TSV 喂 fetch 模拟。
- service / port：带标记单条请求收到音标分片且早于 done；不带标记 / 多条 / 非单词不查；音标查询失败不影响译文；缓存命中时音标仍送达；abort 后不发。
- card / request：满足 / 不满足条件时是否带标记；音标在译文前或后到都能显示；lemma 显示；重译清空。

## 7. 约束

- 只用函数，不用 class；具名导入；对齐 Biome。
- 不新增依赖、不新增权限与 web accessible resource、不改配置结构。

## 8. 实现记录与偏离

数据（30007 词：前 30000 + 手工补词；v2 原始 649KB，gzip 约 194KB）：

- 覆盖率（调研语料 6 个技术文档，15762 词次）：仅词表 85.5%，加规则 94.4%（调研值 83.9% / 93.5%）。
- `different` 在 ECDICT 中是 `'difәrәnt`，转换结果为 `ˈdɪfərənt`，不是方案示例里的 `ˈdɪfrənt`。没有为单个词加特例，测试按实际数据断言。
- 根据 ECDICT 实际数据补充的规则（都在 `notation.ts`，有测试覆盖）：
  - 现代 IPA 写法的条目先折回旧写法再统一转换（`ɪ→i`、`ʊ→u`、`ː→:`、`ˈ→'`、`ˌ→,`），转换结果不变。
  - `j` 后面不是元音时代表 ʊ（`ʌn'dajtidli`→`ʌnˈdaʊtɪdlɪ`、`'mjzlim`→`ˈmʊzlɪm`）。
  - `ou`/`oʊ`/`oə`→`əʊ`，单独的 `o`→`əʊ`；`ɑi`→`aɪ`、`ɑu`→`aʊ`、`ɒi`→`ɔɪ`、`a:`→`ɑː`；单独的 `ɔ`→`ɒ`、`ɛ`→`e`、`a`→`æ`；`ɚ`→`ə`、`ɝ`→`ɜː`、`c`→`k`；`y` 在元音前为 `j`，否则为 `i`。
  - 可选长音 `i(:)`/`u(:)` 记作长音，其余 `(:)` 去掉；括号里只允许单个音素（`(ə)`、`(r)`、`(h)`），否则整条丢弃。
  - 行内备选读音：逗号后的部分与整条读音开头相同、且两边主重音有无一致时，视为备选（`ə'bju:s,ə'bju:z`、`bæθ,bɑ:θ`），取前者。
  - 一条读音有多个主重音时（`'ɑ:ftә'nu:n`），只保留最后一个，其余改为次重音。
  - 连续的重音符合并为一个；词首辅音后的重音符（`t'raɪæŋɡlz`）移到词首。
- 生成脚本额外剔除 ECDICT 中沿用词头读音的变形（如 `ambled` 标成 `ˈæmb(ə)l`）：变形词的规则词尾（-ing、-ed、-est、-s）在读音结尾对不上时不收，查询时由规则还原到词头。约 500 条。
- 生成脚本直接 import `notation.ts`，依赖 Node 的 TypeScript 类型剥离（Node 22.18+ / 23.6+ 默认开启；22.12–22.17 需加 `--experimental-strip-types`），没有新增依赖。

后台与卡片：

- 单词判定去首尾时保留数字（只去标点和空白），否则 `x2`、`mp3` 会被当成 `x`、`mp`。
- `-ed`/`-ing` 的还原顺序：词干以双写辅音结尾时先试原样、再去重复辅音（added→add、stopped→stop）；否则先补 e、再试原样（changed→change 而不是 chang，hoped→hope 而不是 hop）。
- 卡片在发请求时决定是否带标记。从右键菜单或快捷键打开时，语言检测此时往往还没回来，按「检测不可靠」处理，看页面声明语言；首次打开时若配置还没读到，目标语言按「不是 en」处理。

v2（抽样核对后补充，改动 2411 条）：

- happY 元音：读音结尾非重读的短 ɪ 改为 i（lady→ˈleɪdi、aptly→ˈæptli；2007 条）；拼写以 -ies/-ied 结尾、读音以 ɪz/ɪd 结尾的，这个 ɪ 也改为 i（rallied→ˈrælid、armies→ˈɑːmiz；322 条）。双元音的尾音（eɪ、aɪ、ɔɪ）、重读音节（最后一个重音符之后没有其他元音，或无重音符的单音节词，如 sri）不改；词中的 ɪ 不改。
- 读音开头（含紧跟重音符）的 hw 改为 w（whistles→ˈwɪslz、whitespace→ˈwaɪtspeɪs；84 条）；词中的 hw（somewhat、nowhere）不改。
- 两条规则有 2 条重叠（如 whisky→ˈwɪski）。词表选词不变。

## 9. v3：英美双音标

> 2026-11-17 · 状态：实现中（同一分支）

### 9.1 数据

- 美音来源：[open-dict-data/ipa-dict](https://github.com/open-dict-data/ipa-dict) 的 `data/en_US.txt`，commit `972cd67dd5f96bc5660e28070cde26e3928abcd7`（2026-10-22），MIT，Copyright (c) 2016 dohliam。它由 [lingz/cmudict-ipa](https://github.com/lingz/cmudict-ipa)（commit `629483e`，MIT，Copyright (c) 2016 Lingliang Zhang）转换，再用 kylebgorman/syllabify 加重音；底层是 [CMU Pronouncing Dictionary](https://github.com/cmusphinx/cmudict)（许可取自 commit `7479086`，BSD 类许可，Copyright (C) 1993-2015 Carnegie Mellon University）。
- `scripts/build-phonetics.mjs <ecdict.csv> <en_US.txt>` 同时输出：
  - `public/dict/en-gb-phonetic.tsv`：原来的英音表改名，首行 `# ECDICT 39cfb96 · build-phonetics v3`。
  - `public/dict/en-us-phonetic.tsv`：词集与英音表相同，只收 en_US 有的词，取第一读音、去斜杠。首行 `# ipa-dict en_US 972cd67 · build-phonetics v3`。
- 许可：`public/dict/` 下放 `ECDICT-LICENSE.txt`、`ipa-dict-LICENSE.txt`、`cmudict-ipa-LICENSE.txt`、`CMUdict-LICENSE.txt`。
- 美音读音选择：en_US 的第一读音常是口语弱读（counted /ˈkaʊnəd/、contrasts /ˈkɑntɹæs/），改为在同一词条的所有读音中取音素最多的一个（去掉重音符与斜杠后按字符计数，平局取靠前者），再做规范化。
- 美音符号规范（`notation.ts` 的 `toUsIpa`）：按中国学习者熟悉的牛津高阶美音写法改写 en_US 的窄式标音：
  - `ɹ→r`，`ɫ→l`，`ɛ→e`。
  - en_US 不区分 ʌ 和 ə，也不区分重读的 ɝ 和非重读的 ɚ，只能按重音位置改写：重读的 `ə→ʌ`（study ˈstʌdi），重读的 `ɝ→ɜːr`（bird bɜːrd），非重读的 `ɝ→ər`（better ˈbetər）。
  - 加长音：重读的 `i→iː`、`u→uː`；`ɑ→ɑː`、`ɔ→ɔː` 一律加（car kɑːr、water ˈwɔːtər）。非重读的 i、u 保持短音（city ˈsɪti）。
  - 重音：只保留最后一个主重音，其余改次重音；没有主重音时把最后一个次重音升为主重音；单音节词去掉重音符（与英音表一致）；词尾 `ˌ…i` 视为 happY，去掉次重音符。
  - syllabify 会把「辅音 + j」拆开并把重音放在中间（əkˈjumjəˌɫeɪt），改为重音在辅音前（əˈkjuːmjəˌleɪt）；词首 hw 改为 w（与英音表一致）。
  - en_US 的第一读音 `the /ˈðə/` 会转成 ðʌ，手工改为 `ðə`。
  - 结果：26897 词（英音表 30007 词中 en_US 有的），全部转换成功；多音节词都有主重音。

### 9.2 规则变形读音

- 精确未命中、规则还原找到词头时，按后缀从词头读音推出变形读音并直接显示（不再附词头）：
  - -s/-es：词头读音以 s z ʃ ʒ（含 tʃ dʒ）结尾 → +ɪz；以 p t k f θ 结尾 → +s；否则 → +z。
  - -ed：以 t d 结尾 → +ɪd；以 p k f θ s ʃ（含 tʃ）结尾 → +t；否则 → +d。
  - -ing → +ɪŋ。
  - -ies/-ied：词头读音以元音结尾 → +z/+d，词尾非双元音的 ɪ 统一为 i。
  - 英音的连接 r：词尾 `(r)` 在辅音后缀前去掉、在 -ing 前写成 r；拼写以 -r/-re 结尾且读音以元音结尾的词头（enter ˈentə、care keə）在 -ing 前也补 r（ˈentərɪŋ）。
  - 单音节词头（表中不标重音）加了一个音节（ɪz、ɪd、ɪŋ）时，在开头补主重音（watches ˈwɒtʃɪz、making ˈmeɪkɪŋ）。
  - 美音按 en_US 的多数写法（-ed 591 条 ɪd 对 176 条 əd，-es 436 条 ɪz 对 167 条 əz），与英音同用 ɪd、ɪz。
- 推不出来时（读音结尾异常，或 -ies/-ied 的词头不以元音结尾）退回「词头 + 读音」显示。

### 9.3 协议与后台

- 音标分片：`{ id: string; phonetic: { uk?: string; us?: string }; lemma?: string }`，lemma 只在退回词头显示时出现。
- 两张表各自按需懒加载与缓存，失败互不影响。一种口音查不到只发另一种，都没有就不发。若一种口音得到单词本身的读音、另一种只能退回词头，只发前者；都退回词头时以英音的词头为准。
- service 的并行与 await 语义不变。

### 9.4 卡片

- 原文行：单词后依次是「英 /…/ 🔈」「美 /…/ 🔈」两个按钮块（white-space:nowrap，整块换行）；只有一种就只显示一种；退回词头时显示「词头 英 /…/ 美 /…/」。
- 按钮 aria-label 如「英式发音 /…/，点击朗读」，有 focus-visible 样式；悬停浅底色。标签「英」「美」小一号、更淡；喇叭用卡片已有的 speak 图标缩小。
- 按 M3a 方案 4.3 的约定，音标按钮与卡片其余按钮一样是 `tabindex=-1`（不抢网页焦点），保留 aria-label 与 focus-visible 样式；整张卡片的键盘导航留给 M3c。
- 音标沿用卡片的系统无衬线字体（`.r` 的 SANS），为省体积没有单独再写 font-family。
- 原文行原来整行是一个按钮。按钮里不能再放按钮，所以改为：单词本身是展开 / 收起按钮（aria-expanded），「原文」标签和右侧箭头仍可点击展开。
- 点击按钮块：用 speech 模块朗读，lang 分别为 en-GB / en-US，pickVoice 优先该确切 tag 的声音，没有就退回同语种或默认声音。朗读的词与所显示的读音对应：退回词头时读词头，否则读单词。正在朗读时点击会先停止再读。底部朗读按钮行为不变。
- selection-runtime gzip 预算仍为 18KB，超出时先停下汇报。

### 9.5 检查与测试

- check-build：两张表与四份许可都在产物中，两表首行格式正确，都不在 WAR 中。
- check-size：phonetic-gb、phonetic-us 两项，各 250KB。

## 10. v4：全量分片

> 2026-11-17 · 状态：实现中（同一分支）。底部朗读按钮不改。

### 10.1 词集

- 英音：ECDICT 中所有清洗后有效、纯字母的条目，不再按词频截断。其余规则不变：小写 key；全大写缩写与首字母大写的条目只保留有排名的；撇号条目只保留 o'clock、ma'am、y'all；含空格、数字、连字符的排除；变形沿用词头读音的剔除；手工补词照旧。
- 美音：en_US 中所有纯字母条目（加上述三个撇号词），不再限定为英音词集；规范化与「音素最多」的读音选择不变；手工补词照旧。

### 10.2 分片

- 按 key 的前两个字母分片，单字母词放入 `<字母>_` 片（撇号等非字母字符记作 `_`）。文件为 `public/dict/gb/<片>.tsv`、`public/dict/us/<片>.tsv`，只写非空片；每片只有 `word\tipa` 行，按 key 排序。旧的 `en-gb-phonetic.tsv`、`en-us-phonetic.tsv` 删除。
- 某片 gzip 超过 40KB 时，脚本自动把这个前缀再细分到三个字母（`co` → `coa`、`cob`…，两字母词 `co` 进 `co_`），两字母片不再生成。
- 分片清单：脚本生成 `src/lib/phonetic/shards.generated.ts`，按口音列出所有已生成的片名（空格分隔的一个字符串），由后台 import。查找规则：两字母片存在就用它，否则用三字母片；两者都不在清单里，说明这个词不在表中，不发请求。选清单而不是「片头标注」，是因为扩展内不存在的文件 fetch 会直接失败，和网络失败分不开；有了清单就不会去请求不存在的片。
- 数据来源说明放 `public/dict/SOURCES.txt`，首行 `# phonetic tables · build-phonetics v4`，列出 ECDICT 与 ipa-dict 的 commit 和生成脚本用法；许可文件保留在 `public/dict/`。

### 10.3 lookup

- 每种口音按需加载所需分片，包括规则还原时词头所在的片，按片缓存；每种口音最多缓存 128 片，超出时淘汰最近最少使用的片。同一片同时只发一个请求。
- 片加载失败不缓存，下次重试；某口音所需的片加载失败时，这次只缺这种口音，绝不抛到翻译流程。
- 对外接口与分片消息形状不变。

### 10.4 检查

- check-build：`dict/gb`、`dict/us` 目录存在且非空，SOURCES.txt 首行格式正确，许可文件都在，dict 下任何文件都不在 WAR 中。
- check-size：phonetic-gb、phonetic-us 各两项预算：单片 gzip ≤ 40KB，全部分片 gzip 合计 ≤ 2MB。

### 10.5 实现记录

- 词数：英音 174788、美音 117385（并集 244016）。分片：英音 557 片、美音 491 片；最大片 gzip 38.3KB / 21.8KB，没有片超过 40KB，实际没有用到三字母细分（脚本与 lookup 都支持，有单元测试）。合计 raw 4.61MB / 2.57MB，gzip 1.41MB / 0.80MB。
- 不再限于 3 万词以后，ECDICT 里大量没有标成变形的复数、过去式也沿用了词头读音（arbuscules ˈɑːbəskjʊl）。「词尾在读音里对不上就剔除」因此从已知变形推广到所有英音词，-s 的不发音词（corps、chassis、debris 等 16 个）按名单保留。
- 调研语料覆盖率（6 个技术文档）：任一口音精确命中 97.0%，加规则 97.4%，两种口音都有 95.2%。

## 11. 真机验收后的调整（2026-11-17）

| 调整 | 原因 | 位置 |
|---|---|---|
| 语言判断：检测不可靠时，只有页面声明为法、德、西等拉丁字母语言才不查；中文、日文等页面和未声明语言的页面照查 | 中文界面的 Google 搜索页声明 `zh-CN`，按旧规则英文单词一律不查音标 | `selection/request.ts` 的 `wantsPhonetic` |
| 美音按美式拼写互查：-isation/-ise/-yse、-our、-tre、-ogue、双写 l、-ence | 美音表来自 CMUdict，只有美式拼写（internationalisation 查不到） | `phonetic/spelling.ts` |
| hw→w 推广到词中 | overwhelm、nowhere 等词中仍是旧写法 hw | `phonetic/notation.ts` |
| 标签由「英」「美」改为「UK」「US」 | 国际通用，i18n 后中英文界面都不用再翻译；读屏的 aria-label 暂时保留中文 | `selection/card.ts` |
| 朗读卡死修复：cancel 后等 250ms 再 speak；3.5s 不开始就清队列并改用本机声音（最多 2 次），仍失败就复位并提示「朗读没有响应，请稍后再试」；按字数设时长上限；连点只读最后一次；排除趣味声音 | Chrome 的 Google 在线声音在 cancel 之后立即 speak 会永久卡死整个浏览器的朗读队列（已在真实 Chrome 中复现） | `selection/speech.ts` |
| 底部朗读：英文原文默认用美音（en-US）；检测不可靠、但有音标的单词也按英文处理 | 原来检测不可靠时用系统默认声音（中文系统会用中文声音读英文），与 UK/US 按钮的读音不一致 | `selection/card.ts` 的 `toggleSpeech` |
| selection-runtime 预算 18KB → 19KB（用户批准） | 加上英美双音标和朗读兜底后为 18.63KB | `scripts/check-size.mjs` |

验收：`npm run check` 全部通过（69 个测试文件、1349 个用例）。体积（gzip）：content 6.99/7KB、selection-runtime 18.63/19KB、background 57.11/60KB；音标分片合计英音 1.41MB、美音 0.80MB（各 2MB），单片最大 38.33KB（40KB）。用户真机验收通过：中文 Google 页面、长尾词、英式拼写、连点朗读、底部美音朗读均正常。
