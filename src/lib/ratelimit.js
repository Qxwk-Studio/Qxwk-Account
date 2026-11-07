// Qxwk-Account 通行证 · 限流
//
// key 自带维度与时间片（如 login:acct:alice:15m:…），换窗口即换 key，
// 因此计数只需一条 UPSERT 原子 +1，不存在"读旧值—判过期—写回"的竞态。
// 过期行由 Cron 按 expires_at 清掉。

function sqlNow(ts) {
  return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19);
}

// 返回 { ok, count, retryAfter }。ok=false 表示本次已超限。
export async function rateLimit(DB, key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = sqlNow(now + windowSec);
  const row = await DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start, expires_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.expires_at < CURRENT_TIMESTAMP THEN 1
                    ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.expires_at < CURRENT_TIMESTAMP
                           THEN excluded.window_start ELSE rate_limits.window_start END,
       expires_at = CASE WHEN rate_limits.expires_at < CURRENT_TIMESTAMP
                         THEN excluded.expires_at ELSE rate_limits.expires_at END
     RETURNING count, expires_at`,
  ).bind(key, now, expiresAt).first();
  const count = row ? row.count : 1;
  const remaining = Math.max(0, limit - count);
  const expiryMs = row ? Date.parse(`${String(row.expires_at).replace(' ', 'T')}Z`) : Date.now();
  return {
    ok: count <= limit,
    count,
    retryAfter: remaining > 0 ? 0 : Math.max(1, Math.ceil((expiryMs - Date.now()) / 1000)),
  };
}

// 登录成功等场景清掉计数（按账号的失败锁）
export async function clearRateLimit(DB, key) {
  await DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}
