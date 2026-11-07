# 07 · 账户、OAuth、会员、配额与 Coco 后端

## 1. 范围与结论

该安装包的账户不只是微信登录，还包含 Google OAuth、双 token 刷新、扩展与网站之间的短授权码交换、会员模型分层与自有翻译接口。旧包客户端可恢复“请求什么、如何保存和展示、怎样处理失败”，**不能恢复服务器内部的鉴权、配额扣费、模型路由、计费或 OAuth state 校验算法**。

本文全部为静态代码核对，未登录真实账号、未调用旧域名、未发翻译或付款请求。模型名称和会员规则描述的是包内快照，不代表当前线上规则。

主要证据：

- [wechat-auth 排版文件](../../evidence/legacy/formatted/chunks/wechat-auth-DcMIyx4V.js)，LF 10615–10627、10759–10852。
- [登录页](../../evidence/legacy/formatted/chunks/login-BH_tOQ7I.js)，LF 1–45。
- [后台](../../evidence/legacy/formatted/background.js)，LF 7461、7494–7559、8744–8772、8996–9000、9051–9070。
- [模型/会员控件](../../evidence/legacy/formatted/chunks/DisplayModeSelector-aVEBmg_I.js)，LF 1372–1496。
- [保留摘录与来源索引](../../evidence/legacy/extracts/providers/index.json)。行号按 LF 计数，压缩符号含义由函数体解释。

## 2. 架构与模块关系

```text
登录入口（popup/options/login UI）
  → signInWithWeChat(xU) / signInWithGoogle(_U)
  → GET /auth/{provider}/auth-url?redirectUrl=chrome-extension://.../login.html
  → tabs.create(authUrl)
  → 外部授权与后端回调（服务端未知）
  → login.html 查询参数
       auth_code → POST /auth/code/exchange
       code+state → GET /auth/{provider}/callback
  → 校验/归一化 token payload → storage.local[coco_wechat_auth]
  → 拉 /user/users/me → storage watcher更新各UI

Coco 翻译 / 会员查询
  → ensureValidAuthData(dg/ak)
  → accessToken有效就复用；否则共享当前上下文refresh promise
  → /auth/token/refresh → 更新存储 → 刷新用户资料
  → Bearer token 请求接口
```

后台 `Ec/ak/nk/KF` 与页面共享chunk `Td/dg/SU/CU` 是同类逻辑的构建副本，不是完全不同的登录系统。UI 按 storage watch 同步，账户存储名称仍叫 `coco_wechat_auth`，并不意味着只支持微信。

## 3. 已恢复的 API 契约

基地址：`https://cocotranslate.com/api/v1`。对**该基地址本身、其 `/` 子路径或 `?` 查询**的请求，`ai/tb` 追加 `X-App-Id: cocotrans` 和 `X-App-Version: manifest.version`；对别的域名不附加这些标识。这里没有从域名自动附加 Bearer，Bearer由 authFetch 或业务函数独立提供。

| API | 方法与请求 | 客户端期望响应 | 已确认调用点 |
| --- | --- | --- | --- |
| `/auth/wechat/auth-url` | GET `redirectUrl` | `{success:true,data:{authUrl}}` | chunk xU LF10817–10818 |
| `/auth/google/auth-url` | GET `redirectUrl`，扩展redirect带provider=google | 同上 | chunk _U LF10819–10820 |
| `/auth/{wechat或google}/callback` | GET `code,state` | `{success:true,data:AuthPayload}` | chunk wU LF10832–10841 |
| `/auth/code/exchange` | POST JSON `{code:auth_code}` | 同上 | chunk TU LF10842–10851 |
| `/auth/code/generate` | POST，authFetch Bearer | code兼容读取`data.code/data.authCode/code/authCode` | 模型控件 zp LF1378–1387 |
| `/auth/token/refresh` | POST JSON `{refreshToken}` | `{success:true,data:{accessToken?,refreshToken?,user?,session?,...}}` | chunk yU/Td，后台GF/Ec |
| `/user/users/me` | GET Bearer | `{success:true,data:User}` | chunk mA/rb，后台VF |
| `/subscription/plans` | GET，不要求本地token | `{success:true,data:{showcaseModels:[...] ,...}}` | 后台bU LF8997–8998 |
| `/subscription/me` | GET authFetch；无有效token时不请求 | `{success:true,data:{subscription:{isActive,planKey,...},...}}` | 后台vU LF8999–9000 |
| `/translate` | POST Bearer，见第7节 | 根对象`translatedText:string`；失败可有`success:false,error` | 后台Pc LF8744–8772 |

未在本轮账户代码确认到客户端付费下单、退款或支付完成验证接口。会员购买打开网站 `https://cocotranslate.com/subscription/plans`，不能据此恢复站内支付实现。

### 3.1 AuthPayload 与 User

`dA(payload)` 对 `!payload || payload.requiresOtp` 返回 null，要求同时存在 `user/accessToken/refreshToken`。session 缺失时补 `{id:"",expiresAt:...}`。expiry支持有限数值或能Date.parse的字符串；用户头像和昵称按如下来源补齐：

- avatar → metadata.wechat.avatarUrl → metadata.google.avatarUrl → metadata.google.picture。
- nickname → metadata.wechat.nickname → metadata.google.nickname → metadata.google.name。

这里没有看到 OTP 验证界面或续接流程；`requiresOtp` 的服务器语义只能标为未知，而不是“客户端已支持二次验证码”。

## 4. OAuth 与扩展登录页

### 4.1 发起授权

`xU` 的 redirect 为 `runtime.getURL("/login.html")`，Google `_U` 为 `/login.html?provider=google`；拿到 authUrl 后 `tabs.create`。登录页点击按钮时设 loading provider，成功打开外部授权后 `window.close()`，失败保留页面并展示错误。

没有使用 `chrome.identity.launchWebAuthFlow`；旧manifest也不是依靠 identity权限完成该流程。真正第三方client id、服务端secret、state生成及第三方token交换在服务器，不在安装包。

### 4.2 回调解析优先级

登录页 `N` 先处理 `auth_code`，调用短授权码换token；无论交换成功与否，finally会从地址栏删除 auth_code。若没有auth_code，再要求同时存在code与state，provider=google时选Google，否则微信；普通OAuth交换成功后才清空整个query。

成功后先更新用户状态，显示登录成功，等待1500ms导航到扩展 options.html。页面初次挂载也读本地缓存用户，并通过账户存储watch监听后续登录成功。组件卸载会取消watch和跳转定时器。

关键原代码（[login chunk LF7–20](../../evidence/legacy/formatted/chunks/login-BH_tOQ7I.js#L7)，片段截取）：

```js
const t = new URLSearchParams(window.location.search), n = t.get("auth_code"), m = t.get("code"), w = t.get("state");
if (n) {
    r.info("Found auth_code in URL, exchanging for token");
    try {
        const s = await M(n);
        return (s == null ? void 0 : s.user) ?? null;
    }
    finally {
        t.delete("auth_code");
        const s = t.toString(), F = s ? `${window.location.pathname}?${s}` : window.location.pathname;
        window.history.replaceState({}, document.title, F);
    }
}
```

这是从长函数中摘出的连续逻辑，`M` 在import中映射到 exchangeAuthCodeForToken。其完整上下文保留在 [login-callback.js](../../evidence/legacy/extracts/providers/login-callback.js)。

### 4.3 本地 state 校验的边界

普通callback将传入state直接发送后端。**该客户端代码没有把state与本地预存值比较**；不能因此判定后端也未校验。扩展redirect、一次性code的签发绑定、code过期和重放防护均需要服务端契约，无法从此包确认。

## 5. token 存储与刷新

### 5.1 存储

key=`coco_wechat_auth`，经WXT storage `local:`封装写入chrome.storage.local，数据包含token、expiry、user、session。不是cookie登录，也不是以加密vault保存；本地扩展数据可被用户读取。

`lA/ek` 为缺失expiry补默认值：access=当前时间+1小时；refresh=当前时间+30天。读取旧记录发现任一expiry缺失时补值并写回。watch通过`Sa.watch(local:key)`通知UI。

### 5.2 ensureValidAuthData

1. 无记录 → null。
2. refresh expiry到期 → 删除账户记录，返回null，即使access token暂未到期也如此。
3. access token存在且当前时间距到期超过5分钟 → 返回缓存。
4. access即将到期、已过期，或access缺失但refresh存在 → refresh。
5. 无可用access/refresh → 清缓存，返回null。

刷新用模块级 `vs/ri` promise单飞，同一JS上下文并发调用共享结果，finally清空promise。**它不是跨全部扩展页面/后台的分布式锁**，多个上下文仍可能同时刷新。

### 5.3 刷新后的字段合并

POST refresh响应success=false会清缓存；非2xx但不是显式success=false时只返回null，不一定清缓存；形状不合法和网络异常也返回null并记录日志。成功时用旧数据和新data合并，仅缺失或为 null 时保留旧 token、user、session（空字符串不会回退），再调用保存和 `/user/users/me`。

重要旧行为：合并对象在展开服务器data后把两项expiry显式置undefined，所以保存函数重新按**客户端默认1小时/30天**计算，而不是采用refresh响应中可能携带的新expiry。这是原代码事实，不建议默认照搬。

关键原代码（后台 LF7537–7538/页面chunk LF10795–10797，同构）：

```js
const n = { ...e, ...a.data,
  accessToken: a.data.accessToken ?? e.accessToken,
  refreshToken: a.data.refreshToken ?? e.refreshToken,
  user: a.data.user ?? e.user,
  session: a.data.session ?? e.session,
  accessTokenExpiresAt: void 0,
  refreshTokenExpiresAt: void 0
};
await tk(n);
```

上段把原长对象换行以便阅读，变量名保留。原始连续函数见 [backend-auth.js](../../evidence/legacy/extracts/providers/backend-auth.js)。

### 5.4 authFetch 与退出

`CU/KF` 获取有效auth，追加Bearer，fetch；若401且原auth有refresh，再refresh并重试一次；最终仍401则清缓存。它并不验证传入URL必须为自有API，故旧调用者必须正确传入可信URL。

`EU` signOut仅删除本地存储，**没有确认到撤销服务器session/token的API调用**。后台和页面均存在登录资料副本读取函数，不要把本地“显示未登录”理解为服务端session已撤销。

## 6. 会员展示、模型解锁与网站单点登录

### 6.1 会员状态数据

后台 `getSubscriptionState` 并行请求plans和me，分别catch为null，返回`{plans,me}`。plans请求要求data.showcaseModels非空；me无token直接null。UI `Pv` 初始用包内8个fallback模型，远端有showcaseModels才替换；用户账户watch变化时刷新。

客户端仅直接读取部分subscription字段：isActive、planKey、isFirstWeek、cancelAtPeriodEnd。实际剩余字符/金额/周期扣费算法在服务端，不能从这些字段猜出精确配额规则。

### 6.2 模型分层

- 未激活或未知plan → free。
- 激活且planKey=pro → pro；planKey=max → max；其他值也回free。
- tier=free全部可用；ADVANCED需要pro/max；TOP需要max。
- 状态仍加载时控件暂按max生成选项；加载结束后按实际会员给locked标记。
- 选到锁定模型时提示需要Pro/Max并打开购买页；允许的Coco模型仍需登录，保存`aiTranslate.enabled=true,provider=coco,model=选中modelId`。
- 不要把客户端UI锁当作配额或权限安全边界，真正翻译请求还会收到后端MODEL_NOT_IN_PLAN/NO_ACCESS错误。

包内fallback名单的modelId是deepseek-v4-flash、deepseek-v4-pro、gemini-3.1-flash-lite、claude-haiku-4-5、gpt-4o-mini、gpt-5.4、gemini-3.1-pro-preview、claude-sonnet-4-6。**这只是安装包固定列表**；后端plans可覆盖，本文未验证这些模型现时是否可用。

来源：[subscription-models.js](../../evidence/legacy/extracts/providers/subscription-models.js)。

### 6.3 打开会员网站

`zp` 先同步`window.open(plansUrl,"_blank")`避免异步弹窗被阻止，并尝试清opener。若本地存在有效token，POST `/auth/code/generate`获取短code，把新窗口URL替换成`plansUrl?auth_code=...`；失败则仍保留普通购买页。这里没有把accessToken直接放入URL。

短code的有效期、一次性、绑定对象和服务器校验没有前端实现，必须在新后端设计中补契约，不能从函数名假定安全属性。

## 7. Coco 翻译与配额错误

`Pc(text,fromLang,toLang,options)`：先`nk`拿有效accessToken，无token抛“请先登录椰子翻译账号”。POST `/translate`，header Content-Type JSON、Bearer token及X-App标识；credentials=omit。

请求形状：

```ts
// 从Pc对象构建恢复的协议形状，非原始TS源码。
{
  sourceLang: string;
  targetLang: string;
  text: string;
  model: string; // 默认 deepseek-v4-flash
  stream: false;
  systemPrompt?: string;
  customPrompt?: string;
  temperature?: number;
}
```

`systemPrompt/customPrompt`非空才附加，temperature必须typeof number。响应是根对象 `translatedText:string`，**不是强制 data.translatedText**。先尝试JSON解析；reason从`error.details.reason`或`error.code`读取。success=false优先处理；非2xx再处理401和业务reason。

| 情况 | 客户端错误 |
| --- | --- |
| `MODEL_NOT_IN_PLAN` | 当前会员不支持模型，需升级 |
| `QUOTA_EXCEEDED` | 本周期额度已用完，升级或等待恢复 |
| `NO_ACCESS` | 需开通会员 |
| HTTP401 且未先命中 `success:false` | 登录已过期 |
| 其他失败 | error.message → message → statusText → 默认翻译失败 |
| 成功但translatedText不是string | Unexpected response format |

Coco这里直接`ci`请求，不经`authFetch`，所以**收到401不会在此分支自动refresh并重发**；它在发请求前通过nk完成预刷新。需区别于其他authFetch调用。

会员/配额错误在外层队列中不重试；但内容页`vk`对同类Coco错误另有最多3次的模块级上下文累计重试（不是每次调用独立计数，成功后未见重置），并不改变model/provider。详见 [01](01-translation-providers.md)。

### 7.1 字幕文章重写特例

`translateReadingArticleChunk`→`uw`→`NB`→`Pc`，固定Coco和deepseek-v4-flash，与用户通用翻译引擎选择不同。输入字幕格式`timestamp：text`，systemPrompt要求返回`{"items":[{"timestamp":"...","text":"..."}]}`，不增删、合并、拆分条目；包含视频标题/作者/目标语言及用户prompt。

`DB`依次尝试原JSON、去Markdown fence、提取json代码块、截首尾花括号；`OB`校验schema、条数、每项timestamp顺序完全一致，拒绝全空译文。单项空text允许，只有全空拒绝。后台失败消息返回`items:[],provider:coco,model:deepseek-v4-flash,error`，不是默默把输入当译文。字幕页面收到结果后最多尝试3次；匹配两种登录错误文案时标记错误并提示登录，其他返回错误或校验失败用尽次数后逐句调用普通字幕翻译回退；调用直接抛异常时立即进入回退。[字幕脚本 LF9489–9539](../../evidence/legacy/formatted/content-scripts/video-subtitle.js#L9489)。

来源：后台 LF8685–8713、8742–8743、9065–9070。字幕/UI细节参见视频模块。

## 8. 重构方案与分批实施（建议）

### A · 先隔离账户与供应商

新工程先完成不依赖账户的翻译服务。需要Coco时再新增AccountService/AuthStorage/BackendClient，类型化区分未登录、即将过期、刷新中、暂时离线、确实失效。token只在后台操作；不把任意URL交给带Bearer的fetch，不把完整auth或API key放入日志/反馈。

### B · 明确服务端契约

确认继续使用旧后端的授权、redirect允许列表、auth/code交换及expiry规范。令牌过期时间优先采用服务器权威值；本地补默认只用于确实缺失的迁移数据。刷新尽量集中后台统一单飞，避免多个页面同时旋转refreshToken。最终退出若服务端支持应撤销session，再清本地。

### C · 登录回调与会员

将provider限制为明确枚举；从发起授权到state/nonce/回调消费建立一条可测试链路。登录临时code无论成功与否清URL；对requiresOtp有明确未支持提示或续接流程。plans/me单独缓存与失效，不用“未知=最高权限”作为交互默认；锁定UI只是引导，服务端始终判权限。

### D · 错误与翻译请求

统一BackendError `{httpStatus,code,reason,message,retryable}`，区分refresh失败暂态与鉴权失效；避免字符串包含“会员”就认定不可重试。Coco翻译是否允许401后安全重试，必须和计费幂等性一起设计；不要盲目增加重试导致扣费放大。模型列表与可选temperature等能力来自后端声明，不绑定本文的历史型号。

## 9. 模块验收用例

1. 微信/Google各自产生正确redirect；auth_code优先级、code/state缺失和异常provider行为明确。
2. callback成功写auth，用户资料刷新与watch联动；失败不把不完整payload存入账户。
3. access剩余超过5分钟不refresh；即将过期/缺失时refresh；refresh过期时清账户。
4. 并发刷新只有后台一条请求；服务端旋转token及expiry被正确保存。
5. 暂时离线或5xx不误删有效refresh；真正401/无效refresh会清理。
6. authFetch401最多安全重试一次，不把Bearer发送到任意第三方URL。
7. 退出后本地UI立即更新；如果新后端支持，核对服务器session撤销结果。
8. plans失败使用明确fallback，me未知显示未知/可重试；会员tier锁与服务端拒绝保持一致。
9. /translate success:false、401、MODEL_NOT_IN_PLAN、QUOTA_EXCEEDED、NO_ACCESS、畸形JSON、空译文分别测试。
10. 字幕文章JSON修复只修外层封装，条数/顺序/时间戳不符拒绝写回；用户prompt不会破坏强制schema。
11. 短授权码只通过预期网站入口使用，URL清理、过期、重放及绑定由服务端契约验证。

## 10. 明确未知与不能恢复的部分

- OAuth服务器注册信息、第三方secret、state验证、code签发与token加密/签名，不在客户端。
- 实际会员价格、计费周期、余额、配额数字、重试是否扣费、支付渠道，不得从文案推断。
- 服务器对固定App头、模型版本、额度错误码的当前兼容性，没有在线证据。
- 包中通用SDK代码含多种模型API，不代表Coco后端支持这些全部能力。
- 原包声明web_accessible login.html仅对cocotranslate站点开放，是manifest事实；浏览器OAuth重定向在现今Chrome中的完整交互仍需后续在授权的隔离环境验证。
