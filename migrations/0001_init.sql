-- Qxwk-Account 通行证服务 · 初始建表（包含邮箱支持）
-- 用户 / 会话 / 第三方应用注册表 / 登录来源日志 / 邮箱验证码 / 邀请码 / 系统设置

-- 用户表（昵称 + PBKDF2 密码哈希，color 用于头像配色，email 用户资料）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,          -- 格式：salt:hash（PBKDF2 100k 迭代 SHA-256）
  color TEXT NOT NULL,                  -- 头像颜色（USER_COLORS 顺序分配）
  email TEXT,                            -- 用户邮箱（可选、非唯一、仅做格式校验）
  email_verified INTEGER DEFAULT 0,     -- 邮箱已验证标记（0 未验证 / 1 已验证；老数据默认 0）
  created_at TEXT DEFAULT (datetime('now'))
);

-- 会话表：token 直接落库，Bearer 鉴权
-- 多会话模型：同一账号可在多台设备同时登录，各持独立 token，可逐个或一键下线（不再「重新登录轮换旧会话」）
-- user_agent = 登录时的 UA 原始串（设备名由后端 describeDevice() 解析；NULL = 未知设备）
-- last_seen_at = 最后活跃时间，鉴权请求时节流滚动更新（与上次相差 >1 小时才写库）；查询时用 COALESCE(last_seen_at, created_at) 回退
-- 来源两列互斥，合起来划清「登录设备」与「已授权网站」两张卡的分界（两张卡覆盖全部会话，不重不漏）：
--   client_id    = 命中 apps 白名单的来源站点（apps.id）；NULL 表示不是已登记站点带来的
--   client_label = **未登记**来源的原始串（调用方自报的 client 值 / 请求 Origin 头，截断 100 字符）。
--                  它是自报值、不可当权威，界面须标「未登记来源」；批量注销靠它精确匹配
--   两列都为 NULL = 通行证本站直连登录 → 账号中心「登录设备」卡；只要有一列非 NULL → 「已授权网站」卡
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  user_agent TEXT,
  client_id INTEGER,
  client_label TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_seen_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (client_id) REFERENCES apps(id)
);

-- 第三方来源注册表：接入本站的来源白名单（现用于「登录来源归属」，即 sessions.client_id）
-- 接入一个新来源 = INSERT 一行，无需改代码。早先一个 name 兼「展示名」与「匹配串」两职，
-- App 来源只能往 origin 里塞 app:xxx 占位串来蹭它的 UNIQUE，展示名与判定串搅在一起；现拆成两列：
--   display_name = 展示名称：账号中心「已授权网站」卡里给人看的名字（如 "City Footprint"）
--   match_type   = 匹配方式：'origin'（浏览器 / 网页来源）| 'name'（App、服务端直连，没有 Origin 头）
--   match_key    = 检测名称：真正判定来源归属的串。match_type='origin' 时是**规范 origin**
--                  （scheme://host[:port]，无路径、无末尾斜杠，要与请求里的 Origin 完全一致）；
--                  'name' 时是 App 上报的原样应用名（**区分大小写**）
-- 判定只认 match_type + match_key 这一对（见 src/lib.js 的 resolveClient），display_name 不参与匹配
-- 注：跨站 SSO 已下线，本表不再承担 SSO 回调白名单职责，但仍是第三方来源的权威名单
CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'origin'
               CHECK (match_type IN ('origin', 'name')),
  match_key TEXT NOT NULL UNIQUE,
  homepage TEXT,                        -- 主页，用户中心展示用
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS login_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  client_id INTEGER,                    -- NULL = 直连登录 / 未登记来源
  source_origin TEXT,                   -- 未登记来源的原始串（同 sessions.client_label），仅作展示、不参与鉴权
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (client_id) REFERENCES apps(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_log_user ON login_log(user_id);

-- 登录失败限流表（防止无限撞密码）
-- account = 归一化后的账号键（昵称/邮箱统一转小写）；只记失败，登录成功即删除该行
-- fail_count / first_fail_at 组成 15 分钟计数窗口；达到上限后 locked_until = now + 15 分钟，窗口计数清零
-- 与账号是否存在无关（不存在的账号同样计数），避免「429 的有无」泄露账号是否注册
CREATE TABLE IF NOT EXISTS login_attempts (
  account TEXT PRIMARY KEY,
  fail_count INTEGER NOT NULL DEFAULT 0,
  first_fail_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_until TEXT                      -- 锁定截止时间，NULL = 未锁定
);

-- 邮箱验证码表（绑定验证 + 找回密码复用）
-- purpose = 'verify' 绑定验证 | 'reset' 找回密码（同一张表两用途）
-- code 明文存储（D1 私有）；expires_at 过期即失效；used_at 置位后不可再用于后续校验
CREATE TABLE IF NOT EXISTS email_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,             -- 归属用户（reset 时按邮箱定位到该用户）
  email TEXT NOT NULL,                  -- 目标邮箱
  code TEXT NOT NULL,                   -- 6 位数字验证码
  purpose TEXT NOT NULL,                -- 'verify'（绑定邮箱）| 'reset'（找回密码）| 'signup'（邮箱注册）
  expires_at TEXT NOT NULL,             -- 过期时间，如 datetime('now', '+10 minutes')
  used_at TEXT,                         -- 使用时间，NULL = 未使用（用后即焚）
  attempts INTEGER NOT NULL DEFAULT 0,  -- 核销失败次数；累计到上限即作废该码（防 6 位码爆破，见 worker.js consumeEmailCode）
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_codes_user ON email_codes(user_id, purpose);
CREATE INDEX IF NOT EXISTS idx_email_codes_email ON email_codes(email, purpose);

-- 邮箱加唯一索引（避免一人占多邮箱 / 一邮箱绑多号）
-- WHERE email IS NOT NULL：兼容现有「空串→null」逻辑，避免多行 NULL 冲突
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;

-- 一次性注册邀请码表
-- code 唯一；used_at 为空 = 未使用，注册成功后被标记为已使用（用后即焚）
-- created_by = 生成该码的用户 id（NULL = 管理员手工插入），用于溯源
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  used_by INTEGER,                      -- 使用的用户 id
  used_at TEXT,                         -- 使用时间，NULL 表示未使用
  created_by INTEGER,                   -- 生成该码的用户 id（NULL = 管理员手工插入）
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_invite_used ON invite_codes(used_at);
CREATE INDEX IF NOT EXISTS idx_invite_created ON invite_codes(created_by);

-- 系统设置表（键值对，含默认开关；建表即写入三项默认值）
-- 三个开关各管一摊、互不影响：生成邀请码 / 邮箱注册 / 邀请码注册
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,                 -- 设置键
  value TEXT NOT NULL                   -- 设置值
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('invite_generate_enabled', '1');   -- 生成邀请码开关（'1' 允许生成，'0' 暂停生成；只影响账号中心能否取码，不影响已有码注册）
INSERT OR IGNORE INTO settings (key, value) VALUES ('email_register_enabled', '1');    -- 邮箱注册开关（'1' 允许注册，'0' 暂停注册；关掉即隐藏登录页的「邮箱注册」tab）
INSERT OR IGNORE INTO settings (key, value) VALUES ('invite_register_enabled', '1');   -- 邀请码注册开关（'1' 允许注册，'0' 暂停注册；关掉即隐藏登录页的「邀请码注册」tab）

-- 发码限流计数表（只为邮箱验证码防刷服务，见 worker.js 的 bumpRateLimit / checkCodeRateLimit）
-- key 自带维度与时间片，形如 code:ip:1.2.3.4:10m:29700000 / code:email:a@b.com:1d:2026-10-01，
-- 因此换窗口就是换 key，计数只需一条 UPSERT 原子 +1，不必"读旧值—判过期—写回"（那样有竞态）。
-- 旧窗口的行不再被写入，靠 expires_at 在下次新窗口时顺带清掉，故必须有下方索引。
CREATE TABLE IF NOT EXISTS rate_limit (
  key TEXT PRIMARY KEY,                 -- 维度 + 时间片（见上行说明）
  count INTEGER NOT NULL,               -- 该窗口内已累计次数
  expires_at TEXT NOT NULL              -- 窗口结束时间，过期即可删
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit(expires_at);