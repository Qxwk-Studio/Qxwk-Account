-- Qxwk-Account 通行证 · 全新建库（OIDC + Cookie 版）
--
-- 适用：全新的 D1 库（`wrangler d1 create` 之后直接 apply）。
--
-- 结构要点：
--   · 浏览器走标准 OIDC（授权码 + PKCE），会话是 qx_session Cookie
--   · 足迹 Worker 走 POST /auth/direct，只拿 access_token
--   · 用户主键统一 UUID（TEXT）；昵称、颜色是本站保留的产品字段
--   · 不签 refresh_token；JWT 撤销只影响新签发的 token

-- ---------------------------------------------------------------------------
-- 系统设置
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('email_register_enabled', '1');

-- ---------------------------------------------------------------------------
-- 用户
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id                  TEXT PRIMARY KEY,          -- UUID v4，OIDC 的 sub
  nickname            TEXT UNIQUE NOT NULL,      -- 登录支持昵称或邮箱
  color               TEXT NOT NULL,             -- 60 色 Material 调色板
  email               TEXT,                      -- 统一小写；NULL = 未绑定
  email_verified      INTEGER NOT NULL DEFAULT 0,
  password_hash       TEXT NOT NULL,             -- pbkdf2$sha256$<iters>$<salt_b64>$<hash_b64>
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at       DATETIME,
  password_changed_at DATETIME
);

CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;

CREATE TABLE user_profiles (
  user_id               TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name                  TEXT,
  picture               TEXT,
  locale                TEXT,
  zoneinfo              TEXT,
  website               TEXT,
  phone_number          TEXT,
  phone_number_verified INTEGER NOT NULL DEFAULT 0,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 客户端
-- ---------------------------------------------------------------------------
-- 浏览器 OIDC 客户端：redirect_uris 换行分隔、逐字符精确匹配
CREATE TABLE oauth_clients (
  client_id          TEXT PRIMARY KEY,
  client_secret_hash TEXT,                       -- public 客户端为 NULL
  client_name        TEXT NOT NULL,
  client_type        TEXT NOT NULL CHECK (client_type IN ('public','confidential')),
  redirect_uris      TEXT NOT NULL,
  allowed_scopes     TEXT NOT NULL DEFAULT 'openid profile email',
  status             TEXT NOT NULL DEFAULT 'active',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 自有服务端：足迹 Worker 走 /auth/direct，secret 哈希为 SHA-256(secret)
CREATE TABLE api_clients (
  client_id          TEXT PRIMARY KEY,
  client_secret_hash TEXT NOT NULL,
  name               TEXT NOT NULL,
  allowed_scopes     TEXT NOT NULL DEFAULT 'openid profile email',
  access_token_ttl   INTEGER NOT NULL DEFAULT 3600,  -- 秒；足迹建议 604800
  status             TEXT NOT NULL DEFAULT 'active',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- OIDC 授权码 / 授权关系
-- ---------------------------------------------------------------------------
CREATE TABLE oauth_authorization_codes (
  code_hash      TEXT PRIMARY KEY,               -- SHA-256(code)，不存明文
  client_id      TEXT NOT NULL REFERENCES oauth_clients(client_id),
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  scope          TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  nonce          TEXT,
  auth_time      INTEGER NOT NULL,
  expires_at     DATETIME NOT NULL,
  consumed       INTEGER NOT NULL DEFAULT 0,     -- 原子消费标记
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE oauth_grants (
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id           TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  first_authorized_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_authorized_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at          DATETIME,                  -- 非空 = 用户撤销过，下次 /authorize 要确认
  PRIMARY KEY (user_id, client_id)
);

-- ---------------------------------------------------------------------------
-- 会话
-- ---------------------------------------------------------------------------
CREATE TABLE user_sessions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_token_hash TEXT UNIQUE NOT NULL,       -- SHA-256(token)
  login_method       TEXT NOT NULL DEFAULT 'password',  -- password | email_otp
  user_agent         TEXT,
  auth_time          INTEGER NOT NULL,
  expires_at         DATETIME NOT NULL,          -- 30 天滑动续期
  last_seen_at       DATETIME,
  revoked_at         DATETIME,
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 邮箱验证码 / 限流 / 登录审计
-- ---------------------------------------------------------------------------
CREATE TABLE email_verification_codes (
  email      TEXT NOT NULL,
  purpose    TEXT NOT NULL CHECK (purpose IN (
               'register','login','reset_password','verify_email','change_email'
             )),
  code_hash  TEXT NOT NULL,                      -- SHA-256(email:purpose:code)
  user_id    TEXT,
  attempts   INTEGER NOT NULL DEFAULT 0,         -- 连错 5 次作废
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (email, purpose)
);

CREATE TABLE rate_limits (
  key          TEXT PRIMARY KEY,                 -- 维度 + 时间片
  count        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  expires_at   DATETIME NOT NULL
);

CREATE TABLE login_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  method     TEXT NOT NULL,                      -- password | email_otp | direct | oidc
  client_id  TEXT,
  ip         TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 索引
-- ---------------------------------------------------------------------------
CREATE INDEX idx_auth_codes_exp ON oauth_authorization_codes(expires_at);
CREATE INDEX idx_sessions_user  ON user_sessions(user_id);
CREATE INDEX idx_sessions_exp   ON user_sessions(expires_at);
CREATE INDEX idx_evc_exp        ON email_verification_codes(expires_at);
CREATE INDEX idx_rate_exp       ON rate_limits(expires_at);
CREATE INDEX idx_login_log_user ON login_log(user_id, created_at);
