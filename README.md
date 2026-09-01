# 🔑 Qxwk 账号通行证（Passport）

> 青翔未阔工作室的统一账号中心。一处登录，处处通行。

## ✨ 功能一览

- **统一账号**：注册一个通行证账号，获得昵称（可改）+ 专属颜色（60 色 Material 调色板）+ UID
- **邀请码注册**：默认注册需邀请码（`invite_code_required` 开关），账号中心一键生成（一码制：有未使用码则返回、无则生成，消耗后才产下一个）
- **登录页**：登录 / 注册 / 主题切换 / 邀请码字段（按 `invite_code_required` 开关联动显隐）
- **设置密码流程**：DB 中 `password_hash` 为空的账号（管理员预建/导入），登录时引导到「🔑 设置密码」表单，设完即登录
- **账号中心**：个人资料卡 + 修改资料（昵称 / 专属颜色 / 邮箱）+ 重置密码（折叠，无需原密码）+ 邀请码卡 + 最近登录来源 + 退出登录
- **邮箱验证**：账号中心右侧「📧 邮箱验证」卡，填写左侧邮箱 → 发送验证码（Resend 发信）→ 输入验证码绑定；绑定后邮箱标记已验证
- **头像**：**仅 `@qq.com`** 邮箱走 WeAvatar 头像（头像优先级：已绑定邮箱中有 `@qq.com` 且已验证）；邮箱 MD5 由 **后端集中计算**，所有接口统一返回 `avatar`（完整 WeAvatar URL），前端直接消费；无 QQ 邮箱或图片加载失败回退文字头像（昵称首字 + 专属颜色）
- **SSO 回调**：`?redirect=<原站URL>` → 登录成功后跳回原站并携带 token
- **已登录自动跳转**：通行证域名下已有有效会话时，访问带 redirect 的登录页自动跳回原站（一处登录、处处通行）
- **CORS 白名单**：第三方站跨域调用 `/api/me` 验证 token，白名单外域被浏览器拦截

## 🧱 技术栈

- **运行时**：Cloudflare Workers + Static Assets
- **数据库**：D1（SQLite）
- **前端**：原生 HTML / CSS / JS（零依赖）
- **密码**：PBKDF2（10 万次迭代 + 随机盐），不落明文

## 📁 项目结构

```
├── migrations/
│   └── 0001_init.sql       # 建表：users(含email) / sessions / apps / login_log / invite_codes / settings(含3默认开关) / email_codes
├── src/
│   ├── worker.js           # /api/* 路由 + CORS 白名单 + 静态资源回退
│   └── lib.js              # PBKDF2 密码哈希 / 会话 / 颜色分配 / 邀请码生成 / MD5 + getAvatarUrl / sendEmail(Resend) + genEmailCode
├── public/
│   ├── index.html          # 根页分流（有会话→账号中心，无→登录）
│   ├── login.html          # 登录 + 注册 + SSO 回调 + 设置密码
│   ├── account.html        # 账号中心（资料/修改/重置密码/邀请码/登录来源/退出）
│   ├── setup.html          # 首次设置引导页
│   ├── app.js              # API 客户端 + 会话管理（localStorage）
│   └── favicon.webp
├── .gitignore
├── package.json            # npm 脚本（dev/deploy/migrate），零运行时依赖
└── wrangler.toml           # Worker 配置（D1 绑定，database_id 在此填）
```

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

`0001_init.sql` 为全包含迁移，一次性创建全部表并写入三项默认设置（`invite_generate_enabled=1`、`invite_register_enabled=1`、`invite_code_required=1`）；`0002_email.sql` 追加邮箱验证所需的 `email_codes` 表与 `users.email_verified` 列。`migrations apply` 会按顺序自动应用所有待执行迁移。

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

### 5. 插入 SSO 白名单站点

```sql
INSERT INTO apps (name, origin, homepage) VALUES
  ('Qxwk 主页',       'https://qxwkstudio.top',          'https://qxwkstudio.top'),
  ('City Footprint',  'https://travel.qxwkstudio.top',   'https://travel.qxwkstudio.top');
```

执行：`npx wrangler d1 execute qxwk-account --remote --command "<上面的 SQL>"`

### 6. 部署 Worker

```bash
npx wrangler deploy
```

### 7. 自定义域名

Cloudflare 控制台 → 你的 Worker → **设置** → **触发器** → **自定义域** → 加 `account.qxwkstudio.top`。

> 命名约定沿用工作室风格：City Footprint 用 `travel.*`，通行证用 `account.*`。

## 🔌 API 接口

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| GET | `/api/config` | 无 | 公开配置：`{inviteCodeRequired, inviteGenerateEnabled, inviteRegisterEnabled}` |
| POST | `/api/register` | 无 | 注册：`{nickname, password, invite_code?}` → `{token, userId, nickname, color, avatar(null), created_at(ISO8601)}`（需邀请码时校验并消耗；新注册未填邮箱 avatar=null） |
| POST | `/api/login` | 无 | 登录：`{nickname, password, client_id?}` → 成功：`{token, userId, nickname, color, email, avatar, created_at}`；空哈希账号返回 `{need_set_password:true, nickname, color}`（前端据此跳转"设置密码"表单） |
| POST | `/api/set-password` | 无 | 空哈希账号首次设密码：`{nickname, new_password}` → `{token, userId, nickname, color, email, avatar, created_at}`（已设过密码的返回 409） |
| GET | `/api/me` | Bearer | 当前用户：`{userId, nickname, color, email, email_verified, avatar, created_at}` |
| PUT | `/api/profile` | Bearer | 改资料：`{nickname?, color?, email?}` → `{userId, nickname, color, email, avatar, created_at}`（昵称改时校验冲突 409；邮箱不限服务商、可为空；邮箱变更后自动 `email_verified=0` 需重新验证） |
| POST | `/api/email/send-code` | Bearer | 发送验证码：`{email}` → 写入 `email_codes` 并经 Resend 发信（未配置 `EMAIL_API_KEY` 返回 503；60 秒内重发返回 429；验证码 10 分钟有效） |
| POST | `/api/email/verify` | Bearer | 绑定并验证：`{email, code}` → 校验并原子消耗验证码（用后即焚），通过后 `email_verified=1`；邮箱被他人占用返回 409 |
| PUT | `/api/password` | Bearer | 重置密码：`{new_password}`（4-50 字符，无需原密码，保留当前会话） |
| POST | `/api/logout` | Bearer | 退出登录：撤销当前会话 |
| GET | `/api/invite-code` | Bearer | 取本人未使用邀请码（无则生成，一码制） |
| GET | `/api/sso/info?redirect=<url>` | 无 | 校验 redirect 对应来源站点（供登录页 SSO 显示） |
| GET | `/api/login-log` | Bearer | 最近 10 条登录来源（JOIN apps.name） |

**跨站验证 token**（供原站使用）：`fetch('https://account.qxwkstudio.top/api/me', { headers: { Authorization: 'Bearer ' + token } })`。Worker 回显 CORS 白名单头，未在 `apps` 表注册的 Origin 被浏览器拦截。

> 💡 **关于 avatar 字段**：所有返回用户资料的接口都会同步返回 `avatar`（类型 `string | null`）。URL 形如 `https://weavatar.com/avatar/{md5}?s=400&d=404`，请求头需允许跨域（`<img>` 默认允许，建议加 `referrerPolicy="no-referrer"`）。消费方不必自己实现 MD5。

## 🔗 SSO 对接（供各站点接入）

### 流程（跳转带 token）

1. **原站**检测本地无 token → 跳转登录页：
   ```js
   location.href = 'https://account.qxwkstudio.top/login?redirect=' + encodeURIComponent(window.location.href);
   ```
2. **登录页**：无会话显示登录/注册；有会话 → 直接跳回原站（自动携带当前 token，实现免登录）。
3. **登录成功** → 通行证把 token 通过 URL 带回到原站：
   ```
   https://travel.qxwkstudio.top/xxx?token=<64hex>&uid=<userid>&nick=<nickname>
   ```
4. **原站落地**：从 URL 取 `token` → 存入 localStorage → 立即 `history.replaceState` 剥掉 URL 里的 token（防泄漏）→ 之后每次加载用该 token 跨域验证 `/api/me`。

### 原站接入步骤

1. 在通行证 `apps` 表插入你的 `origin`（见部署第 4 步）。
2. 落地页 JS 处理回调参数（见上方「流程」第 4 步）。
3. 后续每次请求用 `Authorization: Bearer <token>` 调用 `/api/me`，200 = 有效、401 = 需重新登录。

> ⚠️ **防 open-redirect**：登录页的 `redirect` 参数仅接受 http/https URL，且 `origin` 命中 `apps` 表白名单才显示「登录后返回 X」并自动跳转；未命中显示警告、登录后停留通行证本站。

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

## 💻 本地开发

```bash
npm i -g wrangler
npx wrangler d1 migrations apply qxwk-account --local   # 本地建表（0001 + 0002）
npx wrangler dev                                        # 默认 localhost:8787
```

本地若要测试邮箱验证，先建 `.dev.vars` 放 `EMAIL_API_KEY=re_xxx`（见「部署指南」第 4 步），`wrangler dev` 自动加载。验证码输入行默认隐藏（`.code-row`），可在控制台执行 `document.getElementById('codeRow').classList.add('show')` 预览样式。

或用 npm 脚本：`npm run dev` / `npm run migrate:local` / `npm run deploy` / `npm run migrate:remote`。

> ⚠️ **本机沙箱环境**：若 `wrangler dev` 报 `EPERM ... registry\qxwk-account`（AppData 写入被沙箱拦截），把 wrangler 的 registry 重定向到项目内可写目录再启动：
> ```powershell
> $env:XDG_CONFIG_HOME="C:\Code\Qxwk-Account\.xdg-config"; npx wrangler dev --local
> ```
> `.xdg-config/` 已在 `.gitignore`，不会被推送。本地 D1 数据在 `.wrangler/state/v3/d1`（同样已忽略）。

本地联调 SSO 回调时，往本地 D1 插入测试应用：

```bash
npx wrangler d1 execute qxwk-account --local --command "INSERT INTO apps (name, origin) VALUES ('本地测试', 'http://localhost:8788')"
```

然后访问 `http://localhost:8787/login?redirect=http://localhost:8788/account.html` 验证回调跳转。

## 🔧 设计说明

- **密码安全**：PBKDF2（10 万次迭代 + 随机盐）哈希存储，不落明文；会话 64 位随机 token，单会话轮换（重新登录使旧 token 立即失效），90 天自动清理。
- **颜色分配**：注册按顺序从 60 色 Material 调色板取色，池子占满后循环。
- **邀请码**：8 位去易混淆字符（I/O/0/1），原子 `UPDATE ... WHERE used_at IS NULL` 消耗（用后即焚）；一码制——用户始终只保留一个未使用码，旧码消耗后才生成下一个，防止生成过多。
- **空哈希账号**：支持管理员预建/导入无密码账号，用户首次登录时引导设置密码。
- **头像 URL 集中计算**：WeAvatar 链接基于 `md5(lowercase(trim(email)))`。**只有 `@qq.com` 邮箱会生成头像 URL**（其它邮箱 `avatar=null`），且仅在邮箱绑定并验证后生效。为保持前后端口径一致、**避免多个项目重复维护 MD5 实现**，本项目后端（`src/lib.js`）保留唯一一份纯 JS MD5（blueimp-md5 v1.1.0 协议）并提供 `getAvatarUrl(email)` 工具函数。所有对外用户资料接口统一返回 `avatar` 字段（完整 URL 或 `null`），City Footprint 等下游项目和本项目前端都只消费 URL，不再自行计算哈希。更换头像服务（例如切到 QQ 官方头像或自托管 Gravatar）只需修改 `getAvatarUrl()` 一处，零下游改动。
- **邮箱验证**：6 位验证码由 `crypto.getRandomValues` 生成；`email_codes` 表一码制（发新码即删该用户旧码），验证时用「用后即焚」原子 UPDATE（同时并发重放只成功一次）；码不存在/过期/已用统一报「验证码错误或已过期」防枚举；60 秒限发防刷；验证通过才写 `users.email_verified=1`。修改邮箱（含清空）会重置 `email_verified=0`，需重新验证。发信走 Resend，密钥经 `EMAIL_API_KEY` 注入（本地 `.dev.vars` / 线上 Secret），不落仓库。
- **响应式边距（前端一致性）**：账号中心、登录、设置密码等所有含页面骨架的页面统一断点和间距规范，新增页面务必遵守：`.navbar-inner 0 24px / main 36 24 60 / card 24px / footer 14 24px`（桌面）→ `@media (max-width: 640px) navbar-inner 0 12 / main 20 12 32 / card 14px / footer 12 12px`（手机），避免不同页面松紧不一。

---

🌐 在线地址：[https://account.qxwkstudio.top](https://account.qxwkstudio.top)

📧 联系邮箱：QxwkStudio@outlook.com

版权所有 2026 青翔未阔工作室
