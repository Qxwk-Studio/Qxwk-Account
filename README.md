# 🔑 Qxwk 账号通行证（Passport）

> 青翔未阔工作室的统一账号中心。一处登录，处处通行。

## ✨ 功能一览

- **统一账号**：注册一个通行证账号，获得昵称（可改）+ 专属颜色（60 色 Material 调色板）+ UID
- **邀请码注册**：默认注册需邀请码（`invite_code_required` 开关），账号中心一键生成（一码制：有未使用码则返回、无则生成，消耗后才产下一个）
- **登录页**：登录 / 注册 / 主题切换 / 邀请码字段（按 `invite_code_required` 开关联动显隐）
- **设置密码流程**：DB 中 `password_hash` 为空的账号（管理员预建/导入），登录时引导到「🔑 设置密码」表单，设完即登录
- **忘记密码**：登录页「忘记密码？」入口，凭**已绑定且已验证的邮箱**发送重置验证码 → 输入验证码+新密码即可重置并登录（防枚举；成功后撤销该账号**全部会话**，所有设备一并登出）
- **登录失败限流**：同一账号 15 分钟内失败满 5 次即锁定 15 分钟（返回 429），登录成功即清零；不区分账号是否存在，避免用 429 探测账号
- **多会话登录**：同一账号可在多台设备/浏览器同时登录，各持独立 token 互不影响；账号中心「登录设备」卡列出**直接登录通行证**的设备（系统 · 浏览器、最后活跃、登录时间），可**逐个下线**或**一键下线其他所有设备**（当前设备不提供下线按钮，避免把自己踢出），卡片底部合并展示最近 5 条登录记录；从第三方站点登录的会话归「已授权网站」卡，两卡互不重叠
- **账号中心**：个人资料卡 + 修改资料（昵称 / 专属颜色 / 邮箱）+ 邮箱验证 + 重置密码（折叠，无需原密码）+ 邀请码卡 + 登录设备（含最近登录记录）+ 已授权网站 + 退出登录
- **已授权网站 + 第三方接入**：其他站点（及应用）调登录/注册时带 `client` 声明来源，服务端用 `apps` 白名单校验后写入 `sessions.client_id`；账号中心「🌐 已授权网站」卡按站点聚合展示（站点名 / origin / 登录处数 / 最近活跃），可**整站注销登录**（撤销本账号在该站点的全部会话），点站点名可**展开查看该站点里的登录设备**并逐台下线。其他网站的后端用 `POST /api/verify` 校验用户带来的 token（只回 `{valid, userId, client}`，不含昵称/邮箱等资料）
- **邮箱验证**：账号中心左列「📧 邮箱验证」卡（在「重置密码」卡上方），填邮箱 → 发送验证码（Resend 发信）→ 输入验证码绑定；绑定后邮箱标记已验证
- **头像**：**仅 `@qq.com`** 邮箱走 WeAvatar 头像（头像优先级：已绑定邮箱中有 `@qq.com` 且已验证）；邮箱 SHA-256 由 **后端集中计算**，所有接口统一返回 `avatar`（完整 WeAvatar URL），前端直接消费；无 QQ 邮箱或图片加载失败回退文字头像（昵称首字 + 专属颜色）
- **CORS 全面放行**：任意 Origin 均可跨域调用 `/api/me`、`/api/verify`（鉴权靠 Bearer token / token 本身，不设来源白名单；`Access-Control-Allow-Methods` 为 `GET, POST, PUT, OPTIONS`）
- **会话与页面加固**：token **落库前先做 SHA-256**（库里只有哈希，D1 被 dump 也无法直接冒用身份；查询仍是主键等值命中，性能与明文一致）；HTML 响应统一带 `Content-Security-Policy`（**脚本只允许本站，不含内联白名单**）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin` 安全头；token 存 localStorage，CSP 即为降低「页面被注入脚本后 token 被直取」风险的主要手段

## 🧱 技术栈

- **运行时**：Cloudflare Workers + Static Assets
- **数据库**：D1（SQLite）
- **前端**：原生 HTML / CSS / JS（零依赖）
- **密码**：PBKDF2（10 万次迭代 + 随机盐），不落明文

## 📁 项目结构

```
├── migrations/
│   └── 0001_init.sql         # 全包含建库文件：users(含email) / sessions(多会话+来源站点) / apps / login_log / login_attempts(失败限流) / invite_codes / settings / email_codes
├── src/
│   ├── worker.js           # /api/* 路由 + CORS 全面放行 + 静态资源回退
│   └── lib.js              # PBKDF2 密码哈希 / 会话(多会话 + 来源站点归属) / 设备名解析 / 颜色分配 / 邀请码生成 / SHA-256 + getAvatarUrl / sendEmail(Resend) + genEmailCode
├── public/
│   ├── index.html          # 根页分流（有本地会话→账号中心，否则→登录页）
│   ├── login.html          # 登录 + 注册 + 设置密码 + 忘记密码
│   ├── account.html        # 账号中心（资料/修改/邮箱验证/重置密码/邀请码/登录设备(含最近登录记录)/已授权网站/退出）
│   ├── setup.html          # 首次设置引导页
│   ├── theme.js            # 主题（浅/深色）——三页共用，须在 <head> 同步加载（否则会闪一下浅色）
│   ├── app.js              # API 客户端 + 会话管理（localStorage）
│   ├── login.js / account.js / setup.js / index.js   # 各页脚本（原内联 <script> 抽出，用 defer 加载）
│   └── favicon.webp
├── .gitignore
├── package.json            # npm 脚本（dev/deploy/migrate），零运行时依赖
└── wrangler.toml           # Worker 配置：D1 绑定（database_id 在此填）+ [assets] 的 binding/run_worker_first
```

## 🔌 API 接口

共 **17 个**接口，按用途分五组。错误响应统一为 `{"error":"中文提示"}` + 语义化状态码。

> **第三方站点调用登录/注册时请带 `client`**：值传本站 origin（浏览器）或应用名（安卓 App / 服务端直连没有 `Origin` 头）。服务端拿 `apps` 表校验，命中才把该会话标记为「来自这个站点」，账号中心的「已授权网站」卡才认得出来；不传或不在白名单内 → 该会话视为通行证直连登录，不出现在该卡里。详见「设计说明 → 第三方接入与来源归属」。

**账号**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/register` | 无 | 注册：`{nickname, password, invite_code?, client?}` → `{token, userId, nickname, color, email(null), avatar(null), created_at(ISO8601)}`（需邀请码时校验并消耗；新注册无邮箱，故 `email`/`avatar` 为 `null`，字段与登录响应保持一致） |
| POST | `/api/login` | 无 | 登录：`{nickname, password, client?}`（`nickname` 字段填**昵称或邮箱**，昵称优先，未命中再按邮箱大小写不敏感匹配）→ 成功：`{token, userId, nickname, color, email, avatar, created_at}`。失败 401「帐号或密码不正确」，**失败次数过多 429**（见「设计说明 → 登录失败限流」）。**空哈希账号**（管理员预建）带 `new_password` 则一并设密并登录；不带则返回 `{need_set_password:true, identity}`，前端据此跳转「设置密码」表单（原 `/api/set-password` 已合并进此接口） |
| GET | `/api/me` | Bearer | 当前用户：`{userId, nickname, color, email, email_verified, avatar, created_at}`（前端渲染自己页面用；下游后端校验 token 请用 `POST /api/verify`，那个还返回 token 的来源站点） |
| PUT | `/api/profile` | Bearer | 改资料：`{nickname?, color?, email?}` → `{userId, nickname, color, email, avatar, created_at}`（昵称冲突 409；邮箱不限服务商、可为空；邮箱变更后自动 `email_verified=0` 需重新验证） |
| PUT | `/api/password` | Bearer | 修改密码：`{new_password}`（4-50 字符，无需原密码；**保留当前会话、不影响其他设备**） |

**邮箱验证码**（发码 / 核销两个动作，绑定邮箱与找回密码共用）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/email/code` | 视 `purpose` | 发送验证码：`{email, purpose?}`。`purpose='verify'`（默认，绑定邮箱，**需登录**）：成功 `{ok:true}`，60 秒内重发 429；`purpose='reset'`（找回密码，**无需登录**）：仅向**已绑定且已验证**的邮箱发信，成功 `{ok:true, msg}`；未知/未验证邮箱 400「该邮箱未验证」，未配置 `EMAIL_API_KEY` 503。验证码 10 分钟有效、60 秒限发一次 |
| POST | `/api/email/verify` | 视场景 | 核销验证码：`{email, code}` 或 `{email, code, new_password, new_password_confirm}`。**不带** `new_password` → 绑定邮箱（需登录，`purpose='verify'`）→ `{ok:true, email}`，邮箱被他人占用 409；**带** `new_password` → 重置密码并登录（无需登录，`purpose='reset'`）→ 撤销该账号全部旧会话（所有设备登出）后签发新会话，返回与登录一致的 `{token, …}`。码不存在/过期/已用/邮箱未验证统一 400「验证码错误或已过期」（防枚举），校验用后即焚、并发重放只成功一次 |

**第三方接入（给其他网站用）**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/verify` | token 本身 | 校验 token（第三方后端用）：`{token}`（也可改用 `Authorization: Bearer`）→ 有效 `{valid:true, userId, client}`，无效一律 `{valid:false}`（**200**，下游按字段判断即可）。**只回最小信息**：调用方需要的只有「这个 token 属于哪个 userId」+「是不是自己站点签发的」（`client`，直连登录为 `null`），昵称/邮箱/头像等资料一律不回（token 泄露者不该顺带拿到邮箱）；要资料请自带 Bearer 调 `/api/me`。**不**更新 `last_seen_at`、不写登录日志（允许下游高频调用） |
| GET | `/api/clients` | Bearer | 已授权网站 + 每站设备：`{clients:[{id, name, origin, homepage, session_count, last_seen_at, sessions:[{id, device, created_at, last_seen_at, current}]}]}`——本账号在哪些登记站点有登录、各几处，`sessions` 子数组供前端「展开该站点看设备」（按 `sessions.client_id` 聚合，仅含 `apps` 白名单内站点；直连登录的会话不在此接口，见 `/api/sessions`） |
| POST | `/api/clients/revoke` | Bearer | 注销某网站的登录：`{id}`（取 `/api/clients` 返回的 id）→ 撤销本账号在该站点的**全部会话**（该网站里需重新登录）→ `{ok, revoked}`；无活跃登录 404。与按设备的 `/api/sessions/revoke` 互补 |

**会话（多设备登录）**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/sessions` | Bearer | 登录设备列表：`{sessions:[{id, device, created_at, last_seen_at, current}]}`（**只含直连登录的会话**，即 `client_id IS NULL`；站点带来的会话见 `/api/clients`。`device` 为后端解析的「系统 · 浏览器」，`current` 标记当前请求所用会话；不返回 token） |
| POST | `/api/sessions/revoke` | Bearer | 下线指定设备：`{id}`（id 取 `/api/sessions` 返回的 id；当前设备不可下线，返回 404） |
| POST | `/api/sessions/revoke-others` | Bearer | 下线除当前设备外的全部设备：→ `{ok, revoked}`（revoked 为被撤销的会话数） |
| POST | `/api/logout` | Bearer | 退出登录：撤销**当前**会话（幂等；其他设备不受影响） |
| GET | `/api/login-log` | Bearer | 最近 5 条登录记录，展示在账号中心「登录设备」卡底部（每条带来源站点名，未登记来源/直连登录显示「直接访问」；含重置密码后的自动登录） |

**公开配置与邀请码**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/config` | 无 | 公开配置：`{inviteCodeRequired, inviteGenerateEnabled, inviteRegisterEnabled}` |
| GET | `/api/invite-code` | Bearer | 取本人未使用邀请码（无则生成，一码制） |

**跨站验证 token**（供原站使用）：`fetch('https://account.qxwkstudio.top/api/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })`（旧写法 `GET /api/me` + Bearer 仍可用，但不返回 token 的来源站点）。Worker 对任意 Origin 回显 CORS 头（全面放行，鉴权靠 token），任意站点均可直接跨域调用。

> 💡 **关于 avatar 字段**：所有返回用户资料的接口都会同步返回 `avatar`（类型 `string | null`）。URL 形如 `https://weavatar.com/avatar/{sha256}?s=400&d=404`（`sha256` = 小写去空格后邮箱的 SHA-256 十六进制），请求头需允许跨域（`<img>` 默认允许，建议加 `referrerPolicy="no-referrer"`）。消费方不必自己实现哈希。

## 🔗 第三方站点接入

> 跨站 SSO / 跳转授权已**下线**，本站不再有「跳过来登录、回跳带 token」的流程（`/?redirect=`、`#_t=<token>`、授权确认页均已移除）。现在第三方站点按下面四步自行接入——**用户在你的站点里输密码，你的前端直接把密码提交到通行证换 token**。

**① 在通行证登记你的站点**（否则账号中心的「已授权网站」卡认不出你，会话会被记为「通行证直连登录」）：

```bash
npx wrangler d1 execute qxwk-account --remote --command "INSERT OR IGNORE INTO apps (name, origin, homepage) VALUES ('你的站点名', 'https://你的域名', 'https://你的域名')"
```

`origin` 必须是**规范 origin**（`scheme://host[:port]`，无路径、无末尾斜杠），要与请求里的 `Origin` 完全一致。

**② 前端直接跨域登录换 token**（推荐：密码只经你的**前端 JS**，不落到你的服务器，更不要自己存密码）：

```js
// 你的网站前端：登录表单提交
const r = await fetch('https://account.qxwkstudio.top/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    nickname: account,          // 昵称或邮箱，均按此字段传（服务端昵称优先，未命中再按邮箱大小写不敏感匹配）
    password: password,
    client: location.origin,    // 声明来源站点；服务端拿 apps 白名单校验，命中才记为「来自你」
  }),
});
if (r.status === 200) {
  const { token, userId, nickname, color, email, avatar, created_at } = await r.json();
  localStorage.setItem('qxwk_token', token);
  // userId 是稳定身份标识，务必用它做你本地账号的映射（nickname 可改，不要当主键）
} else if ((await r.clone().json()).need_set_password) {
  // 该账号是管理员预建的空壳，带 new_password 再调一次 /api/login 即可设密并登录
}
```

浏览器调用时 `Origin` 头本来就会带，`client` 可省；但**安卓 App / 服务端直连没有 `Origin` 头，必须显式传 `client`**（类型为 URL 时按 origin 匹配 `apps.origin`，否则按应用名匹配 `apps.name`）。不在白名单的值一律按「直连登录」处理，不会被误记成某个站点。

**③ 你的后端验证 token**（可选：前端也可以只带 `Authorization: Bearer` 调 `/api/me` 验证；但要用户资料只能走 `/api/me`，`/api/verify` 只回身份归属）：

```js
const r = await fetch('https://account.qxwkstudio.top/api/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token }),      // 也可改用 Authorization: Bearer
});
const d = await r.json();               // 无效 token 也是 200，看 valid 字段
if (!d.valid) return unauthorized();    // token 已被用户下线 / 已随重置密码撤销
const uid = d.userId;                   // 映射到你本地用户表的稳定键；d.client 可判断 token 是不是你站点签发的
// 注意：本接口只回 {valid, userId, client}，不含昵称/邮箱/头像（token 泄露者不该顺带拿到用户邮箱）
```

**④ 处理「被注销」**：用户在账号中心可以按设备下线、也可以按站点**整站注销**（`/api/clients/revoke`）——此后你手里的 token 立刻失效。你的前端遇到业务接口 401 或 `valid:false` 时，要清掉本地 token 并回到自己的登录页，不要假设 token 永久有效。

**几点注意**：注册（`POST /api/register`）同样接受 `client`；本站 CORS 全面放行，任意 Origin 均可跨域调用 `/api/login`、`/api/me`、`/api/verify`；`/api/verify` 不更新 `last_seen_at`、不写登录日志，可高频调用；token 在库里是 **SHA-256 哈希**（原明文只在登录响应里返回一次，服务端不再留存）；会话**不自动过期**，只会在用户主动下线 / 重置密码 / 整站注销时失效，另有「90 天无人使用则回收」的清理（不会因此把在用的设备踢下线）。

## ⚙️ 系统设置（settings 表）

| key | 默认值 | 含义 |
|---|---|---|
| `invite_code_required` | `1` | 注册是否需要邀请码（`1` 需要 / `0` 放开注册） |
| `invite_generate_enabled` | `1` | 允许生成邀请码（`1` 允许 / `0` 暂停） |
| `invite_register_enabled` | `1` | 允许注册（`1` 允许 / `0` 暂停） |

切换示例（放开注册）：

```bash
npx wrangler d1 execute qxwk-account --remote --command "UPDATE settings SET value='0' WHERE key='invite_code_required';"
```

## 🔧 设计说明

- **密码安全**：PBKDF2（10 万次迭代 + 随机盐）哈希存储，不落明文；会话为 64 位随机 token。
- **登录失败限流**：按**账号**（昵称/邮箱统一转小写作为键）计数，记在 `login_attempts` 表：15 分钟窗口内失败满 5 次即锁定该账号 15 分钟，期间登录返回 429，登录成功立即删除记录。为什么不按 IP —— D1 场景下拿不到稳定可信的客户端 IP，而按账号限流正好挡住「针对某个账号的暴力破解」这一主要威胁。**记账与账号是否存在无关**（不存在的账号同样计数、同样会锁），否则「有没有 429」就成了该账号是否注册的探针，防枚举失效。锁定期内继续失败**不会**延长锁定（避免被无限续锁），代价是攻击者可以故意失败 5 次把某人临时锁 15 分钟，这是换取「无法无限撞密码」的已知取舍。走邮箱重置密码成功会一并清掉该账号的失败记录，用户不会被自己撞出的锁挡在门外。
- **多会话模型**：同一账号可在多台设备同时登录，登录/注册/设密只**新增**一条会话，不再踢掉旧会话。`sessions` 表存 `token`（主键，**存的是 SHA-256 哈希**，明文只在登录响应里返回一次；改造前签发的老会话库里仍是明文，由 `resolveSession()` 在首次被人使用时**就地迁移**为哈希，用户不必重新登录）、`user_id`、`user_agent`（UA 原始串）、`client_id`（来源站点，见下条）、`created_at`、`last_seen_at`；设备名由后端 `describeDevice()` 统一解析（UA 顺序判定：先 Edge/Opera 再 Chrome 再 Safari；iOS 上的浏览器是 WebKit 内核、UA 里不含 `Chrome`/`Firefox`，故单独判 `CriOS`/`FxiOS`/`EdgiOS` 前缀），前端只消费结果字符串。`last_seen_at` 在鉴权时**节流滚动更新**（与上次相差 >1 小时才写库，避免每个请求都产生写入）。会话**不自动过期**，但 `createSession` 会顺带回收「**90 天无人使用**」的会话（`COALESCE(last_seen_at, created_at)` 判据，无 `last_seen_at` 的老行按创建时间算），避免 `sessions` 表只增不减；重置密码会撤销全部会话，改密码保留当前会话。下线接口以 `rowid` 为会话标识，并在 `WHERE` 中限定 `user_id`，防止越权删除他人会话。**「登录设备」卡只列直连登录的会话**（`client_id IS NULL`），站点带来的会话归「已授权网站」卡，两卡不重叠。
- **第三方接入与来源归属**：跨站 SSO 已下线，第三方站点改为**自己调 `/api/login`（或 `/api/register`）拿 token 并自行保存**，本站不再做跳转授权。为了让用户看清「哪些网站拿着我的登录」，登录/注册接口接受可选 `client`：传站点 origin（浏览器）或应用名（安卓 App / 服务端直连无 `Origin` 头），服务端由 `resolveClient()` **拿 `apps` 白名单校验**后才写入 `sessions.client_id`——不在白名单一律按 `null` 处理（直连登录），宁可标不出来源也不接受伪造的站点名；同源（通行证自己的页面）不会被误标成站点。账号中心「已授权网站」卡按 `client_id` 聚合展示，`POST /api/clients/revoke` 撤销本账号在该站点的全部会话（= 该网站里需重新登录）。下游后端校验用户带来的 token 用 `POST /api/verify`（body 传 `token` 或 `Authorization: Bearer`，无效返回 `200 {valid:false}`），它比 `/api/me` 多返回 `client`（token 的来源站点），且**不**滚动写 `last_seen_at`、不写登录日志（允许高频调用）。**`client` 只能当「来源标注」，不能当鉴权依据**：服务端调用可以随意伪造 `Origin` 头，`resolveClient` 的白名单仅确保「标出来的站点名是登记过的」，不代表调用者真的来自该站点；同理 `/api/verify` 不做调用方鉴权，任何人拿到 token 都能验证它（故它只回 `{valid, userId, client}`，不含用户资料）。
- **CORS 与页面安全**：API 全面放行 CORS —— 因为鉴权靠显式 `Bearer` 头、不使用 cookie，不存在「浏览器自动附带凭证」的 CSRF 面，放行才能让任意站点前端直接跨域登录。HTML 页面由 Worker 统一补 `Content-Security-Policy`（`script-src 'self'`、`style-src 'self' 'unsafe-inline'`、`img-src` 放行 `weavatar.com`、`frame-ancestors 'none'` 等）+ `X-Content-Type-Options` + `Referrer-Policy`（见 `worker.js` 的 `addSecurityHeaders`）。**`script-src` 已收紧到只有 `'self'`**：原先各页的内联 `<script>` 与内联 `on*` 处理器已全部抽成 `public/*.js` 外链、改为 `data-action` + 事件委托（`login.js` / `account.js` 里的 `ACTIONS` 表）。因此**新增页面或按钮时不要再写内联脚本或 `onclick`**——会被 CSP 直接拦掉且只在控制台报错；改用独立 `.js` + `data-action`。`style-src` 仍保留 `'unsafe-inline'`：页面里有内联 `<style>` 块、且多处用 `style="..."` 做数据驱动着色，拆成 class 不划算。**这些头依赖 `wrangler.toml` 的静态资源配置**：`[assets]` 必须写 `binding = "ASSETS"`（否则 `env.ASSETS` 是 undefined，未命中静态资源的路径会抛异常、线上表现成 Cloudflare 1101）并写 `run_worker_first = true`。默认的 `run_worker_first = false` 是「命中静态文件就由资源服务直接响应、**不进 Worker**」，那样 `/` 与各 `.html` 都会绕过 Worker，CSP 等头一条都不会生效（只有 `/api/*` 是天然进 Worker 的）。
- **颜色分配**：注册按顺序从 60 色 Material 调色板取色，池子占满后循环。
- **邀请码**：8 位去易混淆字符（I/O/0/1），原子 `UPDATE ... WHERE used_at IS NULL` 消耗（用后即焚）；一码制——用户始终只保留一个未使用码，旧码消耗后才生成下一个，防止生成过多。
- **空哈希账号**：支持管理员预建/导入无密码账号（`password_hash` 为空），用户首次登录时 `POST /api/login` 返回 `need_set_password`，前端引导其带 `new_password` 再次调用同一接口完成设密并登录——不再需要单独的设密码接口。
- **头像 URL 集中计算**：WeAvatar 链接基于 `sha256(lowercase(trim(email)))`。**只有 `@qq.com` 邮箱会生成头像 URL**（其它邮箱 `avatar=null`），且仅在邮箱绑定并验证后生效。哈希用 Web Crypto 原生 `crypto.subtle.digest('SHA-256', ...)`（原先手写的 ~150 行纯 JS MD5 已删除；WeAvatar 文档明确 HASH 支持 SHA256 / MD5 并**推荐 SHA256**，未在 WeAvatar 注册过头像时会回退 Gravatar / QQ 头像，故 QQ 头像不受哈希算法变更影响）。因 `crypto.subtle` 只能异步，`getAvatarUrl(email)` 为 **async 函数，调用处必须 `await`**。为保持前后端口径一致、避免多个项目重复维护哈希实现，后端（`src/lib.js`）是唯一实现处；所有对外用户资料接口统一返回 `avatar` 字段（完整 URL 或 `null`），City Footprint 等下游项目和本项目前端都只消费 URL，不再自行计算哈希。更换头像服务（例如切到 QQ 官方头像或自托管 Gravatar）只需修改 `getAvatarUrl()` 一处，零下游改动。
- **邮箱验证**：6 位验证码由 `crypto.getRandomValues` 生成；`email_codes` 表一码制（发新码即删该用户旧码），验证时用「用后即焚」原子 UPDATE（同时并发重放只成功一次）；码不存在/过期/已用统一报「验证码错误或已过期」防枚举；60 秒限发防刷；验证通过才写 `users.email_verified=1`。修改邮箱（含清空）会重置 `email_verified=0`，需重新验证。发信走 Resend，密钥经 `EMAIL_API_KEY` 注入（本地 `.dev.vars` / 线上 Secret），不落仓库。
- **忘记密码**：以**已验证邮箱**为找回身份，复用 `/api/email/code`（`purpose='reset'`）与 `/api/email/verify`（带 `new_password` 分支）两个接口，共用 `email_codes` 表与品牌邮件模板（`renderResetEmail`）。发码时对未注册/未验证邮箱一律返回相同的模糊文案，**且 60 秒重复请求也静默返回成功而非 429**——否则攻击者可用「429 vs 400」区分邮箱是否已注册，防枚举就失效了；核销时未知邮箱统一报「验证码错误或已过期」。重置通过 `hashPassword` 更新哈希、显式调用 `revokeAllSessions()` 撤销该账号全部会话，再签发新会话——被盗会话一并登出（多会话下 `createSession` 不再自动踢人，必须显式撤销）。**未绑定或未验证邮箱的账号无法通过此途径找回**。
- **响应式边距（前端一致性）**：账号中心、登录、设置密码等所有含页面骨架的页面统一断点和间距规范，新增页面务必遵守：`.navbar-inner 0 24px / main 36 24 60 / card 24px / footer 14 24px`（桌面）→ `@media (max-width: 640px) navbar-inner 0 12 / main 20 12 32 / card 14px / footer 12 12px`（手机），避免不同页面松紧不一。

---

## 💻 本地开发

```bash
npm i -g wrangler
npx wrangler d1 migrations apply qxwk-account --local   # 本地建库
npx wrangler dev                                        # 默认 localhost:8787
```

本地若要测试邮箱验证，先建 `.dev.vars` 放 `EMAIL_API_KEY=re_xxx`（见「部署指南」第 4 步），`wrangler dev` 自动加载。验证码输入行默认隐藏（`.code-row`），可在控制台执行 `document.getElementById('codeRow').classList.add('show')` 预览样式。

或用 npm 脚本：`npm run dev` / `npm run migrate:local` / `npm run deploy` / `npm run migrate:remote`。

> ⚠️ **本机沙箱环境**：若 `wrangler dev` 报 `EPERM ... registry\qxwk-account`（AppData 写入被沙箱拦截），把 wrangler 的 registry 重定向到项目内可写目录再启动：
> ```powershell
> $env:XDG_CONFIG_HOME="C:\Code\Qxwk-Account\.xdg-config"; npx wrangler dev --local
> ```
> `.xdg-config/` 已在 `.gitignore`，不会被推送。本地 D1 数据在 `.wrangler/state/v3/d1`（同样已忽略）。

## 🚀 部署指南

> 本项目基于 Cloudflare **Workers + Assets**（不是 Pages Functions），用 `wrangler deploy` 部署。

### 1. 登录并创建 D1 数据库

```bash
npx wrangler login
npx wrangler d1 create qxwk-account      # 输出含 database_id，复制它
```

### 2. 写入 database_id

打开 `wrangler.toml`，把 `database_id` 替换成刚创建的库 ID：

```toml
database_id = "你的-D1-数据库ID"
```

### 3. 应用迁移（建表 + 写默认设置）

```bash
npx wrangler d1 migrations apply qxwk-account --remote
```

```bash
npx wrangler d1 execute qxwk-account --remote --command "INSERT OR IGNORE INTO apps (name, origin, homepage) VALUES ('City Footprint', 'https://travel.qxwkstudio.top', 'https://travel.qxwkstudio.top')"
```

> 已有线上旧库：新增的**表**（如 `login_attempts`）重跑一次建库文件即可补建（`npx wrangler d1 execute qxwk-account --remote --file migrations/0001_init.sql`）；新增的**列**（`sessions.user_agent` / `last_seen_at` / `client_id`）`CREATE TABLE IF NOT EXISTS` 补不了，必须逐条 `ALTER TABLE sessions ADD COLUMN ...` 手工加。

### 4. 配置邮件服务（Resend）与 KEY

邮箱验证依赖 [Resend](https://resend.com) 发信。需在 Resend 后台完成 **发件域名验证**（SPF/DKIM 的 DNS 记录，发件人默认 `no-reply@account.qxwkstudio.top`，见 `src/lib.js` 的 `sendEmail`），否则 Worker 会返回「邮件发送失败」。

密钥 **不要写进 `wrangler.toml`**（会被提交）。分环境存放：

- **本地开发**：在项目根目录建 `.dev.vars`（已在 `.gitignore`，不会提交）：
  ```dotenv
  EMAIL_API_KEY=re_你的_resend_key
  ```
  `wrangler dev` 会自动加载。
- **线上生产**：用密钥存储，不落文件：
  ```bash
  npx wrangler secret put EMAIL_API_KEY   # 粘贴 re_... key，加密存于 Cloudflare Worker
  ```
  或在控制台 Worker → **设置** → **变量与机密** 中添加该 Secret。

### 5. 部署 Worker

```bash
npx wrangler deploy
```

### 6. 自定义域名

Cloudflare 控制台 → 你的 Worker → **设置** → **触发器** → **自定义域** → 加 `account.qxwkstudio.top`。

---

🌐 在线地址：[https://account.qxwkstudio.top](https://account.qxwkstudio.top)

📧 联系邮箱：QxwkStudio@outlook.com

版权所有 2026 青翔未阔工作室
