# 🔑 Qxwk 账号通行证（Passport）

> 青翔未阔工作室的统一账号中心。一处登录，处处通行。
>
> 登录部分从各站点独立出来，做成独立 Worker + 独立 D1。后续 Qxwk 主页、City Footprint、Class-Assistant 等站点逐步接入，一套账号走天下。

## ✨ 功能一览（本期 MVP）

- **统一账号**：注册一个通行证账号，获得昵称 + 专属颜色 + UID
- **独立登录页**：登录 / 注册 / 主题切换，视觉与 Qxwk 主页一致
- **账号中心**：查看账号信息与最近登录来源（哪个站点登录过你）
- **SSO 回调**：`？redirect=<原站URL>` → 登录成功后跳回原站并携带 token
- **已登录自动跳转**：通行证域名下已有有效会话时，访问带 redirect 的登录页自动跳回原站（一处登录、处处通行）
- **CORS 白名单**：第三方站跨域调用 `/api/me` 验证 token，白名单外域被浏览器拦截

## 🧱 技术栈

- **运行时**：Cloudflare Workers + Static Assets
- **数据库**：D1（SQLite）
- **前端**：原生 HTML / CSS / JS（零依赖）

## 📁 项目结构

```
├── migrations/
│   └── 0001_init.sql       # 建表：users / sessions / apps / login_log
├── src/
│   ├── worker.js           # /api/* 路由 + CORS 白名单 + 静态资源回退
│   └── lib.js              # PBKDF2 密码哈希、会话、颜色分配
├── public/
│   ├── index.html          # 根页分流（有会话→账号中心，无→登录）
│   ├── login.html          # 登录 + 注册 + SSO 回调
│   ├── account.html        # 账号中心（含最近登录来源）
│   ├── app.js              # API 客户端 + 会话管理
│   └── favicon.webp
└── wrangler.toml           # Worker 配置（D1 绑定在此填 database_id）
```

## 🚀 部署指南

### 1. 创建 D1 数据库

Cloudflare 控制台 → **Workers & Pages** → **D1** → **创建数据库**，名字 `qxwk-account`。复制生成的一串 UUID。

### 2. 写入 database_id 并部署

打开 `wrangler.toml`，把 `database_id` 替换成你刚创建的 D1 库 ID：

```toml
[[d1_databases]]                                  # 本地开发可先用占位符
database_id = "你的-D1-数据库ID"                    # 部署/本地 --remote 时替换
```

push 后 CF Pages 自动执行 `npx wrangler deploy`，部署成 **Worker + 静态资源 + D1 绑定**。

> ⚠️ 本项目基于 Cloudflare **Workers + Assets**（不是 Pages Functions），部署参考 City Footprint 的 `wrangler.toml` 结构。

### 3. 应用迁移并插入种子数据

```bash
npx wrangler d1 migrations apply qxwk-account --remote
```

然后在 D1 控制台（或 `wrangler d1 execute`）插入最初的接入应用（来源站点）：

```sql
INSERT INTO apps (name, origin, homepage) VALUES
  ('Qxwk 主页',       'https://qxwkstudio.top',          'https://qxwkstudio.top'),
  ('City Footprint',  'https://travel.qxwkstudio.top',   'https://travel.qxwkstudio.top');
```

### 4. 自定义域名

Pages 项目 → **自定义域** → 加 `account.qxwkstudio.top`（指向 Worker + 静态资源）。

> 命名约定沿用工作室风格：City Footprint 用 `travel.*`，通行证用 `pass.*`。

## 🔌 API 接口

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/register` | 无 | 注册：`{nickname, password}` → `{token, userId, nickname, color}` |
| POST | `/api/login` | 无 | 登录：`{nickname, password, client_id?}` → `{token, userId, nickname, color, created_at}` |
| GET | `/api/me` | Bearer | 当前用户信息：`{userId, nickname, color, created_at}` |
| POST | `/api/logout` | Bearer | 退出登录：撤销当前会话（token 立即失效） |
| GET | `/api/sso/info?redirect=<url>` | 无 | 校验 redirect 对应的来源站点（供 login 页 SSO 显示） |
| GET | `/api/login-log` | Bearer | 最近 10 条登录来源（JOIN apps.name） |

**跨站验证 token**（供原站使用）：`fetch('https://account.qxwkstudio.top/api/me', { headers: { Authorization: 'Bearer ' + token } })`。Worker 会回显 CORS 白名单头，未在 `apps` 表注册的 Origin 被浏览器拦截。

## 🔗 SSO 对接（供各站点接入）

### 流程（跳转带 token）

1. **原站**检测本地无 token → 跳转登录页：
   ```js
   location.href = '/login?redirect=' + encodeURIComponent(window.location.href);
   ```
2. **登录页**：无会话显示登录/注册；有会话 → 直接跳回原站（自动携带当前 token，实现免登录）。
3. **登录成功** → 通行证把 token 通过 URL 带回到原站：
   ```
   https://travel.qxwkstudio.top/xxx?token=<64hex>&uid=<userid>&nick=<nickname>
   ```
4. **原站落地**：从 URL 取 `token` → 存入 localStorage → 立即 `history.replaceState` 剥掉 URL 里的 token（防泄漏）→ 之后每次加载用该 token 跨域验证 `/api/me`。

### 原站接入步骤

1. 在通行证 `apps` 表插入你的 `origin`：
   ```sql
   INSERT INTO apps (name, origin, homepage) VALUES ('你的站点', 'https://你的域名', 'https://你的域名');
   ```
2. 落地页 JS 处理回调参数（见上方「流程」第 4 步）。
3. 后续每次请求用 `Authorization: Bearer <token>` 调用 `/api/me`，200 = 有效、401 = 需重新登录。

> ⚠️ **防 open-redirect**：登录页的 `redirect` 参数仅接受 http/https URL，且 `origin` 命中 `apps` 表白名单才显示「登录后返回 X」并自动跳转；未命中显示警告、登录后停留通行证本站。

## 💻 本地开发

```bash
npm i -g wrangler
npx wrangler d1 migrations apply qxwk-account --local   # 本地建表
npx wrangler dev                                        # 默认 localhost:8787
```

本地联调 SSO 回调时，往本地 D1 插入测试应用：

```bash
npx wrangler d1 execute qxwk-account --local --command "INSERT INTO apps (name, origin) VALUES ('本地测试', 'http://localhost:8788')"
```

然后访问 `http://localhost:8787/login?redirect=http://localhost:8788/account.html` 验证回调跳转。

## 🔧 自定义指南

**1. 加入新站点**见上方「SSO 对接」。

**2. 密码安全**：PBKDF2（10 万次迭代 + 随机盐）哈希存储，不落明文；会话 64 位随机 token，单会话轮换（重新登录使旧 token 失效），90 天自动清理。

**3. 颜色分配**：注册按顺序从 30 色 Material 调色板取色，池子占满后循环。

---

🌐 在线地址：[https://account.qxwkstudio.top](https://account.qxwkstudio.top)

📧 联系邮箱：QxwkStudio@outlook.com

版权所有 2026 青翔未阔工作室