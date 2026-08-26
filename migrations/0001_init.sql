-- Qxwk-Account 通行证服务 · 初始建表（包含邮箱支持）
-- 用户 / 会话 / 第三方应用注册表 / 登录来源日志 / 邀请码 / 系统设置

-- 用户表（昵称 + PBKDF2 密码哈希，color 用于头像配色，email 用户资料）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,          -- 格式：salt:hash（PBKDF2 100k 迭代 SHA-256）
  color TEXT NOT NULL,                  -- 头像颜色（USER_COLORS 顺序分配）
  email TEXT,                            -- 用户邮箱（可选、非唯一、仅做格式校验）
  created_at TEXT DEFAULT (datetime('now'))
);

-- 会话表：token 直接落库，Bearer 鉴权；单会话/用户，重新登录轮换
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 第三方应用注册表：SSO 回调 redirect 域名白名单（防 open-redirect）+ 来源站点展示
-- 接入一个新站点 = INSERT 一行（name/origin/homepage），无需改代码
CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                   -- 站点名：如 "City Footprint"
  origin TEXT UNIQUE NOT NULL,          -- 规范 origin（含端口）：https://travel.qxwkstudio.top
  homepage TEXT,                        -- 主页，用户中心展示用
  created_at TEXT DEFAULT (datetime('now'))
);

-- 登录来源日志：每笔带 client_id 的登录记一行（client_id NULL = 直连登录）
CREATE TABLE IF NOT EXISTS login_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  client_id INTEGER,                    -- NULL = 直连登录（未经过具体站点）
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (client_id) REFERENCES apps(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_login_log_user ON login_log(user_id);

-- 应用种子数据不硬编码进迁移（避免绑定域名）。
-- 部署后用以下 SQL 插入（见 README「接入新站点」）：
--   INSERT INTO apps (name, origin, homepage) VALUES
--     ('Qxwk 主页', 'https://qxwkstudio.top', 'https://qxwkstudio.top'),
--     ('City Footprint', 'https://travel.qxwkstudio.top', 'https://travel.qxwkstudio.top');
-- 本地联调另插：INSERT INTO apps (name, origin) VALUES ('本地测试', 'http://localhost:8788');

-- 用户资料说明：
-- - 昵称/颜色/邮箱均可改（昵称唯一，修改时校验冲突）

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
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,                 -- 设置键
  value TEXT NOT NULL                   -- 设置值
);
INSERT OR IGNORE INTO settings (key, value) VALUES ('invite_generate_enabled', '1');   -- 邀请码生成开关（'1' 允许生成，'0' 暂停生成）
INSERT OR IGNORE INTO settings (key, value) VALUES ('invite_register_enabled', '1');   -- 注册开关（'1' 允许注册，'0' 暂停注册）
INSERT OR IGNORE INTO settings (key, value) VALUES ('invite_code_required', '1');      -- 注册是否需要邀请码（'1' 需要，'0' 不需要）