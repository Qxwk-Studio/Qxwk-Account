# 🔑 Qxwk 账号通行证（Passport）

> 青翔未阔工作室的统一账号中心。一处登录，处处通行。

## ✨ 功能一览

- **统一账号**：注册一个通行证账号，获得昵称（可改）+ 专属颜色（60 色 Material 调色板）+ UID
- **邀请码注册**：默认注册需邀请码（`invite_code_required` 开关），账号中心一键生成（一码制：有未使用码则返回、无则生成，消耗后才产下一个）
- **登录页**：登录 / 注册 / 主题切换 / 邀请码字段（按 `invite_code_required` 开关联动显隐）
- **设置密码流程**：DB 中 `password_hash` 为空的账号（管理员预建/导入），登录时引导到「🔑 设置密码」表单，设完即登录
- **忘记密码**：登录页「忘记密码？」入口，凭**已绑定且已验证的邮箱**发送重置验证码 → 输入验证码+新密码即可重置并登录（防枚举；成功后撤销该账号**全部会话**，所有设备一并登出）
- **多会话登录**：同一账号可在多台设备/浏览器同时登录，各持独立 token 互不影响；账号中心「登录设备」卡列出全部设备（系统 · 浏览器、最后活跃、登录时间），可**逐个下线**或**一键下线其他所有设备**（当前设备不提供下线按钮，避免把自己踢出），卡片底部合并展示最近 5 条登录记录
- **账号中心**：个人资料卡 + 修改资料（昵称 / 专属颜色 / 邮箱）+ 重置密码（折叠，无需原密码）+ 邀请码卡 + 邮箱验证 + 登录设备（含最近登录记录）+ 退出登录
- **邮箱验证**：账号中心右侧「📧 邮箱验证」卡，填写左侧邮箱 → 发送验证码（Resend 发信）→ 输入验证码绑定；绑定后邮箱标记已验证
- **头像**：**仅 `@qq.com`** 邮箱走 WeAvatar 头像（头像优先级：已绑定邮箱中有 `@qq.com` 且已验证）；邮箱 SHA-256 由 **后端集中计算**，所有接口统一返回 `avatar`（完整 WeAvatar URL），前端直接消费；无 QQ 邮箱或图片加载失败回退文字头像（昵称首字 + 专属颜色）
- **CORS 全面放行**：任意 Origin 均可跨域调用 `/api/me` 验证 token（鉴权靠 Bearer token，不设白名单）

## 🧱 技术栈

- **运行时**：Cloudflare Workers + Static Assets
- **数据库**：D1（SQLite）
- **前端**：原生 HTML / CSS / JS（零依赖）
- **密码**：PBKDF2（10 万次迭代 + 随机盐），不落明文

## 📁 项目结构

```
├── migrations/
│   └── 0001_init.sql         # 全包含建库文件：users(含email) / sessions(多会话) / apps / login_log / invite_codes / settings / email_codes
├── src/
│   ├── worker.js           # /api/* 路由 + CORS 全面放行 + 静态资源回退
│   └── lib.js              # PBKDF2 密码哈希 / 会话(多会话) / 设备名解析 / 颜色分配 / 邀请码生成 / SHA-256 + getAvatarUrl / sendEmail(Resend) + genEmailCode
├── public/
│   ├── index.html          # 根页分流（有本地会话→账号中心，否则→登录页）
│   ├── login.html          # 登录 + 注册 + 设置密码 + 忘记密码
│   ├── account.html        # 账号中心（资料/修改/重置密码/邀请码/邮箱验证/登录设备(含最近登录记录)/退出）
│   ├── setup.html          # 首次设置引导页
│   ├── app.js              # API 客户端 + 会话管理（localStorage）
│   └── favicon.webp
├── .gitignore
├── package.json            # npm 脚本（dev/deploy/migrate），零运行时依赖
└── wrangler.toml           # Worker 配置（D1 绑定，database_id 在此填）
```

## 🔌 API 接口

共 **14 个**接口，按用途分四组。错误响应统一为 `{"error":"中文提示"}` + 语义化状态码。

**账号**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/register` | 无 | 注册：`{nickname, password, invite_code?}` → `{token, userId, nickname, color, email(null), avatar(null), created_at(ISO8601)}`（需邀请码时校验并消耗；新注册无邮箱，故 `email`/`avatar` 为 `null`，字段与登录响应保持一致） |
| POST | `/api/login` | 无 | 登录：`{nickname, password}`（`nickname` 字段填**昵称或邮箱**，昵称优先，未命中再按邮箱大小写不敏感匹配）→ 成功：`{token, userId, nickname, color, email, avatar, created_at}`。**空哈希账号**（管理员预建）带 `new_password` 则一并设密并登录；不带则返回 `{need_set_password:true, identity}`，前端据此跳转「设置密码」表单（原 `/api/set-password` 已合并进此接口） |
| GET | `/api/me` | Bearer | 当前用户：`{userId, nickname, color, email, email_verified, avatar, created_at}`（各站跨域验证 token 用） |
| PUT | `/api/profile` | Bearer | 改资料：`{nickname?, color?, email?}` → `{userId, nickname, color, email, avatar, created_at}`（昵称冲突 409；邮箱不限服务商、可为空；邮箱变更后自动 `email_verified=0` 需重新验证） |
| PUT | `/api/password` | Bearer | 修改密码：`{new_password}`（4-50 字符，无需原密码；**保留当前会话、不影响其他设备**） |

**邮箱验证码**（发码 / 核销两个动作，绑定邮箱与找回密码共用）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/email/code` | 视 `purpose` | 发送验证码：`{email, purpose?}`。`purpose='verify'`（默认，绑定邮箱，**需登录**）：成功 `{ok:true}`，60 秒内重发 429；`purpose='reset'`（找回密码，**无需登录**）：仅向**已绑定且已验证**的邮箱发信，成功 `{ok:true, msg}`；未知/未验证邮箱 400「该邮箱未验证」，未配置 `EMAIL_API_KEY` 503。验证码 10 分钟有效、60 秒限发一次 |
| POST | `/api/email/verify` | 视场景 | 核销验证码：`{email, code}` 或 `{email, code, new_password, new_password_confirm}`。**不带** `new_password` → 绑定邮箱（需登录，`purpose='verify'`）→ `{ok:true, email}`，邮箱被他人占用 409；**带** `new_password` → 重置密码并登录（无需登录，`purpose='reset'`）→ 撤销该账号全部旧会话（所有设备登出）后签发新会话，返回与登录一致的 `{token, …}`。码不存在/过期/已用/邮箱未验证统一 400「验证码错误或已过期」（防枚举），校验用后即焚、并发重放只成功一次 |

**会话（多设备登录）**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/sessions` | Bearer | 登录设备列表：`{sessions:[{id, device, created_at, last_seen_at, current}]}`（`device` 为后端解析的「系统 · 浏览器」，`current` 标记当前请求所用会话；不返回 token） |
| POST | `/api/sessions/revoke` | Bearer | 下线指定设备：`{id}`（id 取 `/api/sessions` 返回的 id；当前设备不可下线，返回 404） |
| POST | `/api/sessions/revoke-others` | Bearer | 下线除当前设备外的全部设备：→ `{ok, revoked}`（revoked 为被撤销的会话数） |
| POST | `/api/logout` | Bearer | 退出登录：撤销**当前**会话（幂等；其他设备不受影响） |
| GET | `/api/login-log` | Bearer | 最近 5 条登录记录，展示在账号中心「登录设备」卡底部（历史数据可能带来源站点名或来源 origin；跨站 SSO 已下线，新增记录不再含来源） |

**公开配置与邀请码**

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/config` | 无 | 公开配置：`{inviteCodeRequired, inviteGenerateEnabled, inviteRegisterEnabled}` |
| GET | `/api/invite-code` | Bearer | 取本人未使用邀请码（无则生成，一码制） |

**跨站验证 token**（供原站使用）：`fetch('https://account.qxwkstudio.top/api/me', { headers: { Authorization: 'Bearer ' + token } })`。Worker 对任意 Origin 回显 CORS 头（全面放行，鉴权靠 token），任意站点均可直接跨域验证。

> 💡 **关于 avatar 字段**：所有返回用户资料的接口都会同步返回 `avatar`（类型 `string | null`）。URL 形如 `https://weavatar.com/avatar/{sha256}?s=400&d=404`（`sha256` = 小写去空格后邮箱的 SHA-256 十六进制），请求头需允许跨域（`<img>` 默认允许，建议加 `referrerPolicy="no-referrer"`）。消费方不必自己实现哈希。

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
- **多会话模型**：同一账号可在多台设备同时登录，登录/注册/设密只**新增**一条会话，不再踢掉旧会话。`sessions` 表存 `token`（主键）、`user_id`、`user_agent`（UA 原始串）、`created_at`、`last_seen_at`；设备名由后端 `describeDevice()` 统一解析（UA 顺序判定：先 Edge/Opera 再 Chrome 再 Safari），前端只消费结果字符串。`last_seen_at` 在鉴权时**节流滚动更新**（与上次相差 >1 小时才写库，避免每个请求都产生写入）。会话**不自动过期**，过期靠用户主动下线；重置密码会撤销全部会话，改密码保留当前会话。下线接口以 `rowid` 为会话标识，并在 `WHERE` 中限定 `user_id`，防止越权删除他人会话。
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

`0001_init.sql` 为**全包含建库文件**：一次性创建全部表（`users` 含 `email`/`email_verified`、`sessions` 含多会话所需的 `user_agent`/`last_seen_at`、`apps`、`login_log`、`email_codes`、`invite_codes`、`settings`）并写入三项默认设置（`invite_generate_enabled=1`、`invite_register_enabled=1`、`invite_code_required=1`）。所有语句均为 `CREATE TABLE IF NOT EXISTS` / `INSERT OR IGNORE`，可重复执行。**已存在的旧库不会因重跑而补列**——早年建库时若 `sessions` 还没有 `user_agent` / `last_seen_at`，需手工补一次：

```bash
npx wrangler d1 execute qxwk-account --remote --command "ALTER TABLE sessions ADD COLUMN user_agent TEXT; ALTER TABLE sessions ADD COLUMN last_seen_at TEXT;"
```

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
