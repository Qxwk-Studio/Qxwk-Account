// Qxwk-Account 通行证 · 浏览器会话（qx_session Cookie）
//
// token 明文只在 Set-Cookie 里出现一次，库里存 SHA-256。
// 会话 30 天；鉴权时若剩余不足 29 天就顺带续期（滑动），并重新下发 Cookie。
// last_seen_at 与续期都做了节流，避免每个请求都写 D1。

import { cookie, getCookie, isSecureRequest, json, timingSafeEqual } from './http.js';
import { randomHex, sha256Hex, uuid } from './crypto.js';

export const SESSION_COOKIE = 'qx_session';
export const SESSION_TTL = 30 * 86400;

function parseUtc(s) {
  return Date.parse(String(s || '').replace(' ', 'T') + 'Z') || 0;
}

export function sessionCookie(token, secure) {
  return cookie(SESSION_COOKIE, token, { maxAge: SESSION_TTL, secure });
}

export function clearSessionCookie(secure) {
  return cookie(SESSION_COOKIE, '', { maxAge: 0, secure });
}

export async function createSession(DB, userId, request, method = 'password') {
  const token = randomHex(32);
  const hash = await sha256Hex(token);
  const id = uuid();
  const ua = String(request.headers.get('User-Agent') || '').trim().slice(0, 300) || null;
  const authTime = Math.floor(Date.now() / 1000);
  await DB.prepare(
    `INSERT INTO user_sessions
       (id, user_id, session_token_hash, login_method, user_agent, auth_time, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+30 days'), datetime('now'))`,
  ).bind(id, userId, hash, method, ua, authTime).run();
  return { id, token, authTime };
}

// 返回 { id, userId, authTime, token, renew } 或 null
export async function getSession(DB, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const hash = await sha256Hex(token);
  const row = await DB.prepare(
    `SELECT s.id, s.user_id, s.auth_time, s.expires_at, s.last_seen_at, u.status
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.session_token_hash = ?
        AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP`,
  ).bind(hash).first();
  if (!row || row.status !== 'active') return null;

  // 滑动续期：剩余不足 29 天时续到 30 天（一次登录一天内最多写一次）
  const remaining = (parseUtc(row.expires_at) - Date.now()) / 1000;
  const renew = remaining < SESSION_TTL - 3600;
  if (renew) {
    await DB.prepare("UPDATE user_sessions SET expires_at = datetime('now', '+30 days') WHERE id = ?")
      .bind(row.id).run();
  }
  // 活跃时间节流：与上次相差 >1 小时才写
  if (Date.now() - parseUtc(row.last_seen_at) > 3600 * 1000) {
    await DB.prepare("UPDATE user_sessions SET last_seen_at = datetime('now') WHERE id = ?")
      .bind(row.id).run();
  }
  return { id: row.id, userId: row.user_id, authTime: row.auth_time, token, renew };
}

// 鉴权失败时统一返回 401；调用方直接 return 即可
export function unauthorized() {
  return json({ error: '未登录', code: 'unauthorized' }, 401);
}

export async function revokeSession(DB, id, userId) {
  const res = await DB.prepare(
    "UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
  ).bind(id, userId).run();
  return res.meta.changes === 1;
}

export async function revokeOtherSessions(DB, userId, currentId) {
  const res = await DB.prepare(
    "UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id <> ? AND revoked_at IS NULL",
  ).bind(userId, currentId).run();
  return res.meta.changes;
}

export async function revokeAllSessions(DB, userId) {
  const res = await DB.prepare(
    "UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND revoked_at IS NULL",
  ).bind(userId).run();
  return res.meta.changes;
}

// 会话续期后把新 Cookie 追加到响应上（只在 renew 时动手）
export function withSessionCookie(response, request, session) {
  if (!session || !session.renew) return response;
  try {
    response.headers.append('Set-Cookie', sessionCookie(session.token, isSecureRequest(request)));
  } catch {
    // 静态资源响应头可能是只读的；续期失败不影响本次请求
  }
  return response;
}

// UA → 「系统 · 浏览器」；判定顺序敏感，先判更具体的 Edge/Opera 再 Chrome/Safari
export function describeDevice(ua) {
  const s = String(ua || '');
  if (!s) return '未知设备';
  let os = '';
  if (/Windows NT/.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/HarmonyOS|OpenHarmony|ArkWeb/.test(s)) os = 'HarmonyOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';

  let browser = '';
  if (/Edg[A-Za-z]*\//.test(s)) browser = 'Edge';
  else if (/OPR\//.test(s)) browser = 'Opera';
  else if (/EdgiOS\//.test(s)) browser = 'Edge';
  else if (/CriOS\//.test(s)) browser = 'Chrome';
  else if (/FxiOS\//.test(s)) browser = 'Firefox';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Chrome\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';

  if (!os && !browser) return '未知设备';
  return os && browser ? `${os} · ${browser}` : (os || browser);
}

// 给 OIDC 校验做恒定时间比较时复用
export { timingSafeEqual };
