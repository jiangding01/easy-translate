# 账户、会员与后端服务设计

状态：设计稿，待实施。本文定义客户端契约，服务端授权、计费和模型可用性须另行确认。共享错误协议见 [协议与数据](13-protocols-and-data.md)，翻译调度见 [翻译核心](01-translation-core.md)。

## 目标、责任与接口

后台 AccountService 独占 token 与刷新；UI 只接收脱敏账户状态。BackendClient 限制可信 API origin，管理请求头与解析；服务端负责 OAuth 验证、权限、配额和计费。凭据不进日志、反馈或配置导出。

```ts
type AuthState = {status: 'signedOut'|'loading'|'signedIn'|'offline'|'expired'; user?: User};
interface User {id: string; nickname?: string; avatar?: string}
interface LoginTransaction {id: string; provider: 'wechat'|'google'; state: string; expiresAt: number; status: 'pending'|'exchanging'|'consumed'}
interface AuthRecord {accessToken: string; refreshToken: string; accessTokenExpiresAt?: number; refreshTokenExpiresAt?: number; user: User; session: {id: string; expiresAt?: number}}
interface AccountService { getState(): Promise<AuthState>; signIn(provider: 'wechat'|'google'): Promise<void>; handleCallback(url: string): Promise<void>; signOut(): Promise<void>; subscribe(fn: (state: AuthState) => void): () => void }
interface BackendError {kind: string; code: string; httpStatus?: number; message: string; retryable: boolean}
interface CocoTranslation {sourceLang: string; targetLang: string; text: string; model: string; stream: false; systemPrompt?: string; customPrompt?: string; temperature?: number}
```

内部 AuthRecord 不发给内容脚本。旧本地键 `coco_wechat_auth` 位于旧扩展的 local storage，名称并不限制 Google；新扩展 ID 不能直接读取它，用户须重新登录。客户端本地存储不是加密 vault。

## 客户端 HTTP 契约

旧客户端基地址为 `https://cocotranslate.com/api/v1`；旧客户端仅对该基地址本身、其 `/` 子路径或 `?` 查询附 `X-App-Id: cocotrans` 和 `X-App-Version: manifest.version`。这些是历史契约，不能自动作为新部署身份或默认地址；新部署须经服务端确认独立配置 API origin、App ID、版本头和允许的 redirect。Bearer 只发配置并验证的可信 API origin，不得把任意 URL 传给带 token 的 fetch。

下表记录恢复出的历史接口形状。新接入所需的登录事务绑定及刷新字段规则须与服务端确认，按下文约束扩展契约后使用。

| 方法和路径 | 请求与响应 |
| --- | --- |
| GET `/auth/wechat/auth-url`、`/auth/google/auth-url` | query `redirectUrl`；`{success:true,data:{authUrl}}`；redirect 为扩展 `/login.html`，Google 加 `provider=google` |
| GET `/auth/{wechat或google}/callback` | query `code,state`；返回 `{success:true,data:AuthPayload}` |
| POST `/auth/code/exchange` | `{code:auth_code}`；同上 |
| POST `/auth/code/generate` | Bearer；读取 `data.code`、`data.authCode`、`code` 或 `authCode` |
| POST `/auth/token/refresh` | `{refreshToken}`；`{success:true,data:{accessToken?,refreshToken?,user?,session?,...}}` |
| GET `/user/users/me` | Bearer；`{success:true,data:User}` |
| GET `/subscription/plans` | 无本地 token 要求；`{success:true,data:{showcaseModels:[...],...}}` |
| GET `/subscription/me` | Bearer；`{success:true,data:{subscription:{isActive,planKey,...},...}}` |
| POST `/translate` | Bearer、JSON、credentials omit；`CocoTranslation`；成功根对象 `translatedText:string`，失败可能 `{success:false,error}` |

AuthPayload 必须有 user、accessToken、refreshToken；`requiresOtp` 明确返回不支持或进入后续已实现流程，不能当成功。缺 session 可迁移为空 id；用户 avatar 依次取 avatar、wechat.avatarUrl、google.avatarUrl、google.picture，nickname 类似取 nickname、wechat.nickname、google.nickname、google.name。expiry 支持有限数字或可解析日期，优先服务端权威值；旧客户端读取缺失 expiry 的记录时按当前时间补 access 1 小时、refresh 30 天；刷新成功也会丢弃响应 expiry 并重新计算。新方案不自动沿用这一估算：迁移或响应缺少可信到期值时标记 expiry 未知并要求重新认证或由已确认的服务端协议决定，不能静默延长凭据寿命。

## 登录、刷新及会员流程

```text
signIn(provider):
  create one-time LoginTransaction and persist in storage.session
  bind server authorization request to that transaction using confirmed state/challenge contract
  request auth-url with allowlisted redirect; open authorization tab
callback(url):
  parse auth_code or code/state together with known provider and transaction binding
  clear sensitive query in finally
  reject missing, expired, consumed or mismatched transaction
  verify code is bound to this transaction on server; single-flight the exchange
  validate full payload and expiry; atomically persist then consume transaction
  refresh user; broadcast state

ensureAuth():
  if either expiry is unknown: retain record for diagnosis; require reauthentication; return expired
  if refresh expired or explicitly invalid: clear and return expired
  if access expires in > 5 minutes: return access
  join background single-flight refresh
  on transient failure: retain record and return offline
  on invalid refresh: clear
  on valid refresh response: merge and validate next AuthRecord atomically
  if next expiry is unknown: retain record; require reauthentication
```

两种回调都必须绑定后台创建的一次性登录事务。auth_code也不能仅凭知道短码就覆盖当前会话，须由服务端证明短码属于本地事务，或采用已确认的等效挑战绑定；契约未确认时不启用该分支。事务记录保存在storage.session以支持worker冷启动，过期或消费后不可重放。服务端必须约定 state/nonce、redirect allowlist、短 code 的过期、一次性、绑定与重放防护；旧客户端只转发 state，不证明服务端验证。401 的普通 authFetch 可刷新后重试一次；Coco 翻译旧实现只预刷新，收到 401 不自动重发。新实现只有确认请求幂等与计费语义后才允许安全重试。退出立即清本地并广播；若服务端提供撤销接口，先尝试撤销并明确报告结果，不声称本地清理已撤销服务端 session。

刷新响应先整体校验再合并。token字段缺失时保留旧值，显式null、空串或非法类型拒绝本次响应；user/session如提供则必须通过各自schema，省略时保留。token未变化且expiry省略时保留原expiry；token发生旋转时，只有与新token关联的可信expiry才能替换，否则该expiry设为未知并要求重新认证，不能沿用旧token的寿命。无效的响应不部分覆盖当前记录，合法旋转结果连同到期状态以单次存储写入提交。

plans 和 me 分别加载、缓存及失效；未知状态显示未知/重试，不按最高权限展示。旧 tier 为未激活或未知 free，pro/max 对应 planKey；ADVANCED 需 pro/max、TOP 需 max。UI 锁只提示，后端始终裁决。旧八项 fallback modelId：deepseek-v4-flash、deepseek-v4-pro、gemini-3.1-flash-lite、claude-haiku-4-5、gpt-4o-mini、gpt-5.4、gemini-3.1-pro-preview、claude-sonnet-4-6，仅作历史回退，不保证现可用；优先服务端 showcaseModels。旧版购买打开 `https://cocotranslate.com/subscription/plans`；新部署须确认自己的可信购买地址。打开时先同步开窗口，取得短 code 后追加 `auth_code`；失败保留普通页面，不在 URL 放 accessToken。支付、价格和配额算法未从客户端恢复。

Coco 默认 model `deepseek-v4-flash`，仅附非空 prompt 和数值 temperature。错误 reason 从 `error.details.reason` 或 `error.code` 取；区分 `MODEL_NOT_IN_PLAN`、`QUOTA_EXCEEDED`、`NO_ACCESS`、401、畸形 JSON/响应和空译文。处理 `success:false` 与 HTTP 状态时保留两者信息，避免覆盖明确业务错误。字幕文章请求历史固定 Coco 和该默认模型；输入时间戳及文本，要求 JSON `items[{timestamp,text}]`。只修复 Markdown fence 或外围包装，严格验证条数、顺序与时间戳，全空拒绝。文章错误分类、最多三次调用的预算、幂等门槛及回退以[阅读与文章模块](06-subtitle-reading.md)为准；登录错误只提示，配额/会员/无权访问直接失败，异常或协议解析错误可按配置提前回退。用户 prompt 不得覆盖强制结构。

## 配置、生命周期与差异

默认未登录；账户监听及登录页跳转定时器在卸载时清理。服务端契约未确认时禁用依赖账户的操作，不能用假 token 或固定凭据替代。

| 旧行为 | 新设计 |
| --- | --- |
| 刷新单飞仅限各 JS 上下文；服务端 expiry 被默认值覆盖 | 后台统一单飞，保留服务端旋转 token 和 expiry |
| 临时网络错误与失效处理不一致；refresh 显式失败清缓存 | 区分暂态和确定失效，不因离线误删 |
| 登录回调普通 code 仅成功时清 query；客户端未比较 state | 所有分支清敏感参数，验证本地 state 并依赖服务端验证 |
| 会员加载时暂按最高 tier；Coco 配额有上下文累计重试 | 未知态明确展示，配额不重试 |
| 退出仅本地删除 | 本地立即退出，服务端撤销仅在接口存在时执行 |

## 验收用例

1. 两种 OAuth redirect、auth_code 优先、缺 code/state、未知 provider、失败时清 URL、state不匹配、不完整payload、跨事务auth_code注入、事务过期和重放。
2. access 超过/不足 5 分钟、refresh 过期、并发刷新、token 轮换、服务器 expiry、离线及无效 refresh；token不离开可信域；缺失字段保留、显式空token拒绝、仅access旋转、refresh旋转但缺expiry、部分字段畸形及worker在写入前后停止。
3. plans 与 me 独立失败、未知会员、各 tier 锁及服务端拒绝；短 code 的绑定、过期和重放由服务端集成验证。
4. `/translate` 根响应、success=false、401、三种业务 reason、畸形和空结果；未确认幂等时没有重复计费请求。
5. 文章字幕数量、顺序、时间戳、全空与登录错误分别验证；取消与卸载后无陈旧 UI 更新。
