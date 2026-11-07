# 🔑 Qxwk 账号通行证（Passport）

> 青翔未阔工作室的统一账号中心。一处登录，处处通行。
> 线上地址：[account.qxwkstudio.top](https://account.qxwkstudio.top)

第二版：从「前端拿 Bearer token」改为 **标准 OIDC + Cookie 会话**，并为自有服务端保留一条不跳转的 `/auth/direct`。

## ✨ 两种登录方式

| | 浏览器（标准 OIDC） | 自有服务端（`/auth/direct`） |
|---|---|---|
| 使用者 | 通行证自己的页面、第三方网站 | 足迹 Worker 这类服务端 |
| 凭证 | 授权码 + PKCE（S256） | Basic `client_id:client_secret` + 用户密码 |
| 返回 | `id_token` + `access_token` | 只有 `access_token` |
| 会话 | `qx_session` Cookie（HttpOnly / Secure / SameSite=Lax，30 天滑动） | 不建会话、不设 Cookie |
| refresh | 不签发 | 不签发 |
| CORS | 不放行 | 不放行 |

登录方式：密码（昵称或邮箱）或邮箱验证码。注册走邮箱验证码；邀请码功能已整体删除。

## 🧱 技术栈

- **运行时**：Cloudflare Workers + Static Assets（`run_worker_first`）
- **数据库**：D1
- **令牌**：ES256（Web Crypto ECDSA P-256）
- **密码**：PBKDF2-SHA256，10 万次迭代，格式 `pbkdf2$sha256$<iters>$<salt_b64>$<hash_b64>`
- **前端**：原生 HTML/CSS/JS，零依赖，中英双语
- **邮件**：Resend
- **清理**：Cron Trigger 每小时

## 📁 项目结构

```
migrations/
└── 0001_oidc.sql          # 全新建库基线（适用全新的 D1 库）
src/
├── index.js               # Worker 入口：路由 / 安全头 / Cron
└── lib/
    ├── http.js            # JSON / 错误 / Cookie / base64url / 恒定时间比较
    ├── crypto.js          # SHA-256 / PBKDF2（新旧格式）/ UUID / 随机数
    ├── jwt.js             # ES256 签发、验签、JWKS
    ├── oidc.js            # discovery / jwks / authorize / token / userinfo
    ├── session.js         # qx_session 会话、设备解析
    ├── email.js           # 验证码、临时邮箱名单、Resend 模板
    ├── ratelimit.js       # D1 原子限流
    ├── users.js           # 昵称/颜色/头像/资料
    └── settings.js
public/
├── index.html / index.js  # 根路径分流（问 /api/me）
├── login.html / login.js  # 登录 / 验证码登录 / 注册 / 重置密码
├── account.html / account.js  # 资料 / 密码 / 邮箱 / 设备 / 授权应用
├── app.js                 # API 客户端（Cookie，不存 token）
├── i18n.js / theme.js     # 双语 / 深浅色
└── style.css
scripts/
└── gen-oidc-key.mjs       # 生成 OIDC 私钥 JWK
```

> 旧库的一次性迁移文件**不在仓库里**，放在 `C:\Code\Qxwk-Account-迁移\0002_oidc.sql`，只用于把线上旧表改名保留并复制数据。

## 🗄️ 数据库（11 张表）

| 表 | 作用 |
|---|---|
| `users` | UUID 主键、昵称、专属颜色、邮箱、PBKDF2 密码 |
| `user_profiles` | OIDC 扩展资料（name / picture / locale / zoneinfo / website / phone） |
| `oauth_clients` | 浏览器 OIDC 客户端：`redirect_uris`、`allowed_scopes`、public/confidential |
| `api_clients` | 服务端客户端：secret 哈希、`access_token_ttl` |
| `oauth_authorization_codes` | 授权码（只存 SHA-256、60 秒、`consumed` 原子消费） |
| `oauth_grants` | 用户 × 客户端授权关系（「已授权应用」卡的数据源） |
| `user_sessions` | 浏览器会话（token 只存 SHA-256） |
| `email_verification_codes` | 五种用途的邮箱验证码（5 分钟、连错 5 次作废） |
| `rate_limits` | 限流计数（key 自带维度与时间片） |
| `login_log` | 登录审计，仅保留 90 天 |
| `settings` | `email_register_enabled` 注册总开关 |

## 🔌 接口

**OIDC**（无 CORS、无 refresh）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/.well-known/openid-configuration` | discovery |
| GET | `/jwks` | ES256 公钥（`kid=k1`） |
| GET/POST | `/authorize` | 授权码 + PKCE；被撤销过的客户端会先出确认页 |
| POST | `/token` | `authorization_code` 兑换；`meta.changes===1` 才签发 |
| GET/POST | `/userinfo` | Bearer access_token；按 scope 收窄字段 |

**本站 API**（Cookie 会话）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/config` | `{registerEnabled}` |
| POST | `/api/login` | `{account, password}`，昵称或邮箱 |
| POST | `/api/logout` | 撤销当前会话，清 Cookie |
| GET/PATCH | `/api/me` | 当前资料 / 改昵称、颜色与 profile 字段 |
| POST | `/api/me/password` | `{old_password, new_password}`，撤销其他会话 |
| POST | `/api/me/email/send` | `verify_email` 或 `change_email` |
| POST | `/api/me/email/verify` | `{purpose, code}` |
| POST | `/api/auth/email/send` | 公共发码：`register` / `login` / `reset_password` |
| POST | `/api/auth/email/verify` | 公共核销：注册 / 验证码登录 / 重置密码 |
| GET | `/api/sessions` | 登录设备 |
| POST | `/api/sessions/revoke` | 下线指定设备 |
| POST | `/api/sessions/revoke-others` | 下线其他设备 |
| GET | `/api/clients` | 已授权应用 |
| POST | `/api/clients/revoke` | 撤销某应用（下次授权需确认） |

**自有服务端**

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/direct` | Basic + `{account, password}`，只回 access_token |

## 🔐 安全要点

- 密码 8-128 位、弱密码表；PBKDF2 10 万次；旧 `salt:hash` 可登录并就地升级
- 会话/授权码/验证码全部只存 SHA-256
- Cookie `HttpOnly; SameSite=Lax; Path=/`，HTTPS 下加 `Secure`（localhost 自动不加）
- 所有写接口校验 `Origin` 同源 + `Content-Type: application/json`
- OIDC 强制 PKCE S256；`redirect_uri` 逐字符精确匹配；`response_type` / `grant_type` / client `status` 全校验
- 授权码 60 秒、一次性；`/token`、`/userinfo`、`/auth/direct` 不加 CORS
- 发码防刷：临时邮箱黑名单 + 每邮箱 3 次/小时 + 每 IP 20 次/小时 + 每邮箱 10 次/天
- 登录失败：按账号 5 次/15 分钟锁定；按 IP 30 次/15 分钟
- 邮箱验证码：5 分钟、连错 5 次作废
- 全站 CSP：`script-src 'self'`，无内联脚本；`frame-ancestors 'self'`

**已知取舍**

- 不签 refresh_token：浏览器会话 30 天滑动；`/auth/direct` 的 token 到期后需重新登录
- JWT 无状态：撤销会话不会让已签发的 access_token 立刻失效，最多等 TTL（默认 1 小时；足迹可配 7 天）
- OIDC 静默同意：只在用户撤销过该客户端时弹确认页
- `users.email` 允许为空（保留账号中心清空邮箱的能力），与「规格的 NOT NULL」有一处偏离
- 没有 CORS：第三方站点只能通过跳转 OIDC，或由自己的服务端调 `/auth/direct`

## 🔧 配置

### Worker Secret

```powershell
npx.cmd wrangler secret put ISSUER                # https://account.qxwkstudio.top
npx.cmd wrangler secret put OIDC_PRIVATE_KEY_JWK  # node scripts/gen-oidc-key.mjs 的输出
npx.cmd wrangler secret put EMAIL_API_KEY         # re_...
```

### 本地开发

```powershell
# .dev.vars（已在 .gitignore）
# ISSUER=http://localhost:8787
# OIDC_PRIVATE_KEY_JWK={"kty":"EC",...}
# EMAIL_API_KEY=re_...

$env:XDG_CONFIG_HOME="C:\Code\Qxwk-Account\.xdg-config"
npx.cmd wrangler d1 migrations apply qxwk-account --local
npx.cmd wrangler dev
```

## 🚀 部署

### 场景 A：全新 D1 库

```powershell
npx.cmd wrangler d1 create qxwk-account-v2
# 把新 database_id 填进 wrangler.toml
npx.cmd wrangler d1 migrations apply qxwk-account-v2 --remote
npx.cmd wrangler deploy
```

### 场景 B：迁移线上旧库

```powershell
# 1. 先导出
npx.cmd wrangler d1 export qxwk-account --remote --output=backup-before-oidc.sql

# 2. 执行仓库外的一次性迁移（旧表改名为 *_old、复制 users/settings、标记迁移已应用）
npx.cmd wrangler d1 execute qxwk-account --remote --file="C:\Code\Qxwk-Account-迁移\0002_oidc.sql"

# 3. 部署新代码
npx.cmd wrangler deploy
```

旧表全部保留为 `users_old`、`sessions_old`、`apps_old` 等，确认无误后可自行删除。
旧 `sessions` / `email_codes` / `rate_limit` / `login_attempts` / `invite_codes` 不导入，旧会话全部失效，所有用户重新登录。

### 场景 C：登记客户端

```sql
-- 浏览器 OIDC 客户端（public + PKCE）
INSERT INTO oauth_clients (client_id, client_name, client_type, redirect_uris, allowed_scopes)
VALUES ('travel-web', 'City Footprint', 'public',
        'https://travel.qxwkstudio.top/auth/callback',
        'openid profile email');
```

```powershell
# 服务端客户端 secret：打印一次原文与 SHA-256
node -e "const c=require('node:crypto');const s=c.randomUUID()+c.randomUUID();console.log(s);console.log(c.createHash('sha256').update(s).digest('hex'))"
```

```sql
INSERT INTO api_clients (client_id, client_secret_hash, name, allowed_scopes, access_token_ttl)
VALUES ('travel-worker', '<上一步的 sha256>', 'City Footprint Worker',
        'openid profile email', 604800);
```

足迹 Worker 用这个 `client_id` / `client_secret` 调 `POST /auth/direct`，再用返回的 access_token 调 `/userinfo`。

## 🔁 Cron

`wrangler.toml` 已配置 `crons = ["0 * * * *"]`，每小时清理：

- 过期授权码、过期验证码、过期限流计数
- 过期或已撤销超过 7 天的会话
- 90 天前的登录日志

## 🧹 从旧版删除的东西

- 旧 Bearer 接口：`/api/verify`、token 版 `/api/login`、`/api/invite-code`、`/api/login-log`
- 邀请码整套（表、生成、卡片、两个设置开关）
- 前端 localStorage token；登录态改为 HttpOnly Cookie
- `apps` 来源白名单（改为 `oauth_clients` / `oauth_grants`）

---

🌐 在线地址：<https://account.qxwkstudio.top>
📧 联系邮箱：QxwkStudio@outlook.com

版权所有 2026 青翔未阔工作室
