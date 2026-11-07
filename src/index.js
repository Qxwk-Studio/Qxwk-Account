// Qxwk-Account 通行证 · Worker 入口
//
// 三套入口：
//   1. 标准 OIDC（浏览器）：/authorize → /login.html → /token → /userinfo
//   2. 自有服务端：POST /auth/direct（Basic client_secret + 用户密码）
//   3. 通行证本站：qx_session Cookie + /api/*
//
// 安全基线：Cookie 只走同源；所有写操作校验 Origin + JSON Content-Type；
// /token、/userinfo、/auth/direct 不加 CORS，只允许服务端调用。

import {
  json, error, text, isSecureRequest, timingSafeEqual,
} from './lib/http.js';
import {
  sha256Hex, uuid, hashPassword, verifyPassword,
} from './lib/crypto.js';
import { rateLimit, clearRateLimit } from './lib/ratelimit.js';
import { getSetting } from './lib/settings.js';
import {
  USER_COLORS, isValidEmail, isValidNickname, isValidPassword, passwordRuleText,
  normalizeEmail, findUserByAccount, getUserById, getMe, assignColor,
} from './lib/users.js';
import {
  sessionCookie, clearSessionCookie, createSession, getSession,
  revokeSession, revokeOtherSessions, revokeAllSessions, withSessionCookie, describeDevice,
} from './lib/session.js';
import {
  isEmailConfigured, isTempEmail, genEmailCode, emailCodeHash, sendCodeEmail,
  EMAIL_CODE_MAX_TRY,
} from './lib/email.js';
import {
  handleDiscovery, handleJwks, handleAuthorize, handleToken, handleUserinfo,
} from './lib/oidc.js';
import { signJwt } from './lib/jwt.js';

const LOGIN_FAIL_LIMIT = 5;
const LOGIN_FAIL_WINDOW = 15 * 60;

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '';
}

function secure(request) {
  return isSecureRequest(request);
}

async function readJson(request) {
  return request.json().catch(() => ({}));
}

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function guard(request, { origin = true } = {}) {
  if (origin && !sameOrigin(request)) return error('请求来源不合法', 403, 'forbidden_origin');
  const ct = request.headers.get('Content-Type') || '';
  if (!ct.toLowerCase().startsWith('application/json')) {
    return error('请求格式不正确', 415, 'unsupported_media_type');
  }
  return null;
}

function unauthorized() {
  return error('未登录', 401, 'unauthorized');
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// 邮箱验证码：发送 / 核销
// ---------------------------------------------------------------------------
const SENDABLE_PURPOSES = new Set(['register', 'login', 'reset_password']);

async function bump(DB, key, limit, windowSec) {
  return rateLimit(DB, key, limit, windowSec);
}

async function tooMany(remainingSeconds) {
  const minutes = Math.max(1, Math.ceil(remainingSeconds / 60));
  return error(`操作过于频繁，请 ${minutes} 分钟后再试`, 429, 'rate_limited', { minutes });
}

// 核销一条验证码；成功返回 { ok:true, row }，失败统一返回 null（调用方报同一条错误）
async function consumeEmailCode(DB, { email, purpose, code, userId = null }) {
  const row = userId
    ? await DB.prepare(
      `SELECT * FROM email_verification_codes
        WHERE user_id = ? AND purpose = ? AND expires_at > CURRENT_TIMESTAMP
        ORDER BY created_at DESC LIMIT 1`,
    ).bind(userId, purpose).first()
    : await DB.prepare(
      `SELECT * FROM email_verification_codes
        WHERE email = ? AND purpose = ? AND expires_at > CURRENT_TIMESTAMP`,
    ).bind(email, purpose).first();

  if (!row) return null;
  if ((row.attempts || 0) >= EMAIL_CODE_MAX_TRY) {
    await DB.prepare('DELETE FROM email_verification_codes WHERE email = ? AND purpose = ?')
      .bind(row.email, row.purpose).run();
    return null;
  }

  const hash = await emailCodeHash(row.email, row.purpose, code);
  if (hash !== row.code_hash) {
    await DB.prepare('UPDATE email_verification_codes SET attempts = attempts + 1 WHERE email = ? AND purpose = ?')
      .bind(row.email, row.purpose).run();
    await delay(200);
    return null;
  }

  const del = await DB.prepare(
    'DELETE FROM email_verification_codes WHERE email = ? AND purpose = ? AND code_hash = ?',
  ).bind(row.email, row.purpose, hash).run();
  if (del.meta.changes !== 1) return null;
  return row;
}

async function storeCode(DB, { email, purpose, userId = null }) {
  const code = genEmailCode();
  const hash = await emailCodeHash(email, purpose, code);
  await DB.prepare(
    `INSERT INTO email_verification_codes (email, purpose, code_hash, user_id, attempts, expires_at)
     VALUES (?, ?, ?, ?, 0, datetime('now', '+5 minutes'))
     ON CONFLICT(email, purpose) DO UPDATE SET
       code_hash = excluded.code_hash,
       user_id = excluded.user_id,
       attempts = 0,
       expires_at = excluded.expires_at,
       created_at = CURRENT_TIMESTAMP`,
  ).bind(email, purpose, hash, userId).run();
  return code;
}

async function trySendCode(env, to, purpose, code) {
  try {
    await sendCodeEmail(env, to, purpose, code);
  } catch (e) {
    // 发信失败不向调用方暴露（否则可用于枚举邮箱是否有效），只记日志
    console.error('send code failed:', e && e.message);
  }
}

// ---------------------------------------------------------------------------
// 登录 / 会话
// ---------------------------------------------------------------------------
async function loginFailCount(DB, key) {
  const row = await DB.prepare(
    'SELECT count FROM rate_limits WHERE key = ? AND expires_at > CURRENT_TIMESTAMP',
  ).bind(key).first();
  return row ? row.count : 0;
}

async function noteLoginFailure(DB, accountKey) {
  await rateLimit(DB, accountKey, LOGIN_FAIL_LIMIT, LOGIN_FAIL_WINDOW);
}

async function finishPasswordLogin(DB, user, request, method = 'password') {
  const session = await createSession(DB, user.id, request, method);
  await DB.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id).run();
  await DB.prepare('INSERT INTO login_log (user_id, method, client_id, ip) VALUES (?, ?, NULL, ?)')
    .bind(user.id, method, clientIp(request) || null).run();
  const me = await getMe(DB, user.id);
  return { session, me };
}

// ---------------------------------------------------------------------------
// 资料更新
// ---------------------------------------------------------------------------
// 只允许更新 user_profiles 里不重复的字段；name/picture 分别由昵称与邮箱头像派生
const PROFILE_FIELDS = ['locale', 'zoneinfo', 'website'];

function cleanProfileValue(key, value) {
  if (value === null || value === undefined || value === '') return { value: null };
  const s = String(value).trim();
  if (key === 'website') {
    if (!/^https:\/\//i.test(s)) return { error: '链接必须以 https:// 开头' };
    if (s.length > 500) return { error: '链接过长' };
    return { value: s };
  }
  if (key === 'locale') {
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(s)) return { error: '语言格式不正确' };
    return { value: s };
  }
  if (key === 'zoneinfo') {
    if (!/^[A-Za-z_]+(\/[A-Za-z_]+)+$/.test(s)) return { error: '时区格式不正确' };
    return { value: s };
  }
  return { value: s };
}

async function updateProfile(DB, userId, body) {
  const current = await DB.prepare('SELECT * FROM user_profiles WHERE user_id = ?').bind(userId).first() || {};
  const next = {
    // name/picture 不再单独存：OIDC 输出时用昵称与邮箱头像派生；这里顺手清掉历史重复数据
    name: null,
    picture: null,
    locale: current.locale ?? null,
    zoneinfo: current.zoneinfo ?? null,
    website: current.website ?? null,
    phone_number: current.phone_number ?? null,
    phone_number_verified: current.phone_number_verified ?? 0,
  };
  for (const key of PROFILE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const cleaned = cleanProfileValue(key, body[key]);
    if (cleaned.error) return { error: cleaned.error };
    next[key] = cleaned.value;
  }
  await DB.prepare(
    `INSERT INTO user_profiles
       (user_id, name, picture, locale, zoneinfo, website, phone_number, phone_number_verified, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       name = excluded.name,
       picture = excluded.picture,
       locale = excluded.locale,
       zoneinfo = excluded.zoneinfo,
       website = excluded.website,
       phone_number = excluded.phone_number,
       phone_number_verified = excluded.phone_number_verified,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(userId, next.name, next.picture, next.locale, next.zoneinfo, next.website,
    next.phone_number, next.phone_number_verified).run();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// API 路由
// ---------------------------------------------------------------------------
async function handleApi(request, env, url) {
  const DB = env.DB;
  const path = url.pathname;
  const method = request.method;

  // 公开配置
  if (method === 'GET' && path === '/api/config') {
    const registerEnabled = (await getSetting(DB, 'email_register_enabled', '1')) === '1';
    return json({ registerEnabled });
  }

  // 密码登录（本站页面）
  if (method === 'POST' && path === '/api/login') {
    const blocked = guard(request);
    if (blocked) return blocked;
    const body = await readJson(request);
    const account = String(body.account || body.nickname || '').trim();
    const password = String(body.password || '');
    if (!account) return error('请填写昵称或邮箱', 400, 'account_required');

    const key = `login:acct:${account.toLowerCase()}`;
    if ((await loginFailCount(DB, key)) >= LOGIN_FAIL_LIMIT) {
      return error('登录失败次数过多，请 15 分钟后再试', 429, 'login_locked', { minutes: 15 });
    }
    const ipKey = clientIp(request) ? `login:ip:${clientIp(request)}` : '';
    if (ipKey) {
      const ipHit = await bump(DB, ipKey, 30, LOGIN_FAIL_WINDOW);
      if (!ipHit.ok) return tooMany(ipHit.retryAfter);
    }

    const user = await findUserByAccount(DB, account);
    if (!user || user.status !== 'active') {
      await noteLoginFailure(DB, key);
      await delay(300);
      return error('帐号或密码不正确', 401, 'invalid_credentials');
    }

    const verified = await verifyPassword(password, user.password_hash);
    if (!verified.ok) {
      await noteLoginFailure(DB, key);
      await delay(300);
      return error('帐号或密码不正确', 401, 'invalid_credentials');
    }

    // 老格式哈希登录成功后升级成新格式
    if (verified.needsRehash) {
      const upgraded = await hashPassword(password);
      await DB.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(upgraded, user.id).run();
    }

    await clearRateLimit(DB, key);
    const { session, me } = await finishPasswordLogin(DB, user, request, 'password');
    return json({ ok: true, data: me }, 200, { 'Set-Cookie': sessionCookie(session.token, secure(request)) });
  }

  // 退出登录（幂等）
  if (method === 'POST' && path === '/api/logout') {
    const session = await getSession(DB, request);
    if (session) await revokeSession(DB, session.id, session.userId);
    return new Response(null, {
      status: 204,
      headers: { 'Set-Cookie': clearSessionCookie(secure(request)), 'Cache-Control': 'no-store' },
    });
  }

  // 当前用户
  if (method === 'GET' && path === '/api/me') {
    const session = await getSession(DB, request);
    if (!session) return unauthorized();
    const me = await getMe(DB, session.userId);
    if (!me) return unauthorized();
    return withSessionCookie(json(me), request, session);
  }

  if (method === 'PATCH' && path === '/api/me') {
    const blocked = guard(request);
    if (blocked) return blocked;
    const session = await getSession(DB, request);
    if (!session) return unauthorized();
    const body = await readJson(request);
    if (Object.prototype.hasOwnProperty.call(body, 'email')) {
      return error('修改邮箱请走邮箱验证流程', 400, 'use_email_flow');
    }
    if (Object.prototype.hasOwnProperty.call(body, 'status')) {
      return error('不能修改账号状态', 400, 'readonly_field');
    }
    const user = await getUserById(DB, session.userId);
    if (!user) return unauthorized();

    if (Object.prototype.hasOwnProperty.call(body, 'nickname')) {
      const nickname = String(body.nickname || '').trim();
      if (!isValidNickname(nickname)) return error('昵称需为 1-20 个字符', 400, 'invalid_nickname');
      if (nickname !== user.nickname) {
        const clash = await DB.prepare('SELECT 1 FROM users WHERE nickname = ? AND id <> ?')
          .bind(nickname, user.id).first();
        if (clash) return error('昵称已被占用，换一个吧', 409, 'nickname_taken');
        await DB.prepare('UPDATE users SET nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
          .bind(nickname, user.id).run();
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'color')) {
      if (typeof body.color !== 'string' || !USER_COLORS.includes(body.color)) {
        return error('颜色无效，请从预置色板中选择', 400, 'invalid_color');
      }
      await DB.prepare('UPDATE users SET color = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(body.color, user.id).run();
    }

    const updated = await updateProfile(DB, user.id, body);
    if (updated.error) return error(updated.error, 400, 'invalid_profile');
    return withSessionCookie(json(await getMe(DB, user.id)), request, session);
  }

  // 修改密码（需原密码，保留当前会话）
  if (method === 'POST' && path === '/api/me/password') {
    const blocked = guard(request);
    if (blocked) return blocked;
    const session = await getSession(DB, request);
    if (!session) return unauthorized();
    const body = await readJson(request);
    const oldPassword = String(body.old_password || '');
    const newPassword = String(body.new_password || '');
    const user = await getUserById(DB, session.userId);
    if (!user) return unauthorized();

    if (!(await verifyPassword(oldPassword, user.password_hash)).ok) {
      await delay(300);
      return error('原密码不正确', 401, 'invalid_credentials');
    }
    if (!isValidPassword(newPassword)) return error(passwordRuleText(), 400, 'invalid_password');
    if ((await verifyPassword(newPassword, user.password_hash)).ok) {
      return error('新密码不能与原密码相同', 400, 'same_password');
    }

    const hash = await hashPassword(newPassword);
    await DB.prepare("UPDATE users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(hash, user.id).run();
    await revokeOtherSessions(DB, user.id, session.id);
    return json({ ok: true });
  }

  // 账号中心：给当前邮箱发验证码 / 换邮箱发验证码
  if (method === 'POST' && path === '/api/me/email/send') {
    const blocked = guard(request);
    if (blocked) return blocked;
    const session = await getSession(DB, request);
    if (!session) return unauthorized();
    if (!isEmailConfigured(env)) return error('邮件服务暂不可用', 503, 'email_unavailable');

    const body = await readJson(request);
    const purpose = String(body.purpose || '');
    const user = await getUserById(DB, session.userId);
    if (!user) return unauthorized();

    const hit = await bump(DB, `otp:send:user:${user.id}:${purpose}`, 3, 3600);
    if (!hit.ok) return tooMany(hit.retryAfter);

    if (purpose === 'verify_email') {
      if (user.email_verified) return error('邮箱已验证', 400, 'already_verified');
      if (!user.email) return error('请先绑定邮箱', 400, 'email_required');
      await DB.prepare("DELETE FROM email_verification_codes WHERE email = ? AND purpose = 'verify_email'")
        .bind(user.email).run();
      const code = await storeCode(DB, { email: user.email, purpose, userId: user.id });
      await trySendCode(env, user.email, purpose, code);
      return json({ ok: true }, 202);
    }

    if (purpose === 'change_email') {
      if (!(await verifyPassword(String(body.password || ''), user.password_hash)).ok) {
        await delay(300);
        return error('密码不正确', 401, 'invalid_credentials');
      }
      const newEmail = normalizeEmail(body.new_email);
      if (!isValidEmail(newEmail)) return error('请输入正确的邮箱地址', 400, 'invalid_email');
      if (isTempEmail(newEmail)) return error('不支持临时邮箱，请使用常用邮箱', 400, 'temp_email_not_allowed');
      if (newEmail === normalizeEmail(user.email)) return error('新邮箱与当前邮箱相同', 400, 'same_email');
      const taken = await DB.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?')
        .bind(newEmail, user.id).first();
      if (taken) return error('该邮箱已被其他账号使用', 409, 'email_taken');

      await DB.prepare("DELETE FROM email_verification_codes WHERE user_id = ? AND purpose = 'change_email'")
        .bind(user.id).run();
      const code = await storeCode(DB, { email: newEmail, purpose, userId: user.id });
      await trySendCode(env, newEmail, purpose, code);
      return json({ ok: true }, 202);
    }

    return error('不支持的用途', 400, 'invalid_purpose');
  }

  if (method === 'POST' && path === '/api/me/email/verify') {
    const blocked = guard(request);
    if (blocked) return blocked;
    const session = await getSession(DB, request);
    if (!session) return unauthorized();
    const body = await readJson(request);
    const purpose = String(body.purpose || '');
    const code = String(body.code || '');
    const user = await getUserById(DB, session.userId);
    if (!user) return unauthorized();
    if (!code) return error('请输入验证码', 400, 'code_required');

    const hit = await bump(DB, `otp:verify:user:${user.id}:${purpose}`, 5, 900);
    if (!hit.ok) return tooMany(hit.retryAfter);

    const row = await consumeEmailCode(DB, { email: user.email, purpose, code, userId: user.id });
    if (!row) return error('验证码错误或已过期', 400, 'invalid_code');

    if (purpose === 'verify_email') {
      await DB.prepare('UPDATE users SET email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(user.id).run();
      return json({ ok: true });
    }
    if (purpose === 'change_email') {
      const taken = await DB.prepare('SELECT 1 FROM users WHERE email = ? AND id <> ?')
        .bind(row.email, user.id).first();
      if (taken) return error('该邮箱已被其他账号使用', 409, 'email_taken');
      await DB.prepare('UPDATE users SET email = ?, email_verified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(row.email, user.id).run();
      await revokeOtherSessions(DB, user.id, session.id);
      return json({ ok: true, email: row.email });
    }
    return error('不支持的用途', 400, 'invalid_purpose');
  }

  // 公共发码（注册 / 验证码登录 / 找回密码）
  if (method === 'POST' && path === '/api/auth/email/send') {
    const blocked = guard(request);
    if (blocked) return blocked;
    if (!isEmailConfigured(env)) return error('邮件服务暂不可用', 503, 'email_unavailable');

    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const purpose = String(body.purpose || '');
    if (!SENDABLE_PURPOSES.has(purpose)) return error('不支持的用途', 400, 'invalid_purpose');
    if (!isValidEmail(email)) return error('请输入正确的邮箱地址', 400, 'invalid_email');
    if (isTempEmail(email)) return error('不支持临时邮箱，请使用常用邮箱', 400, 'temp_email_not_allowed');
    if (purpose === 'register' && (await getSetting(DB, 'email_register_enabled', '1')) !== '1') {
      return error('注册已暂停，暂不接受新注册', 403, 'register_paused');
    }

    const ipKey = clientIp(request) ? `otp:send:ip:${clientIp(request)}` : '';
    if (ipKey) {
      const hit = await bump(DB, ipKey, 20, 3600);
      if (!hit.ok) return tooMany(hit.retryAfter);
    }
    const emailHit = await bump(DB, `otp:send:email:${email}:${purpose}`, 3, 3600);
    if (!emailHit.ok) return tooMany(emailHit.retryAfter);
    const dayHit = await bump(DB, `otp:day:${email}`, 10, 86400);
    if (!dayHit.ok) return tooMany(dayHit.retryAfter);

    // 发码只看邮箱，不能复用登录的「昵称或邮箱」查找：昵称恰好等于该邮箱时会认错人
    const user = await DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    let shouldSend = false;
    let userId = null;
    if (purpose === 'register') {
      shouldSend = !(await DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first());
    } else if (purpose === 'login') {
      shouldSend = !!(user && user.status === 'active' && user.email_verified);
      userId = user ? user.id : null;
    } else if (purpose === 'reset_password') {
      shouldSend = !!(user && user.status === 'active');
      userId = user ? user.id : null;
    }

    if (shouldSend) {
      const code = await storeCode(DB, { email, purpose, userId });
      await trySendCode(env, email, purpose, code);
    }
    // 无条件 202，响应体一致，避免成为邮箱是否注册的探针
    return json({ ok: true, message: '如果该邮箱符合条件，验证码已发送' }, 202);
  }

  // 公共核销（注册 / 验证码登录 / 找回密码）
  if (method === 'POST' && path === '/api/auth/email/verify') {
    const blocked = guard(request);
    if (blocked) return blocked;
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const purpose = String(body.purpose || '');
    const code = String(body.code || '');
    if (!SENDABLE_PURPOSES.has(purpose)) return error('不支持的用途', 400, 'invalid_purpose');
    if (!isValidEmail(email)) return error('请输入正确的邮箱地址', 400, 'invalid_email');
    if (!code) return error('请输入验证码', 400, 'code_required');
    if (purpose === 'register' && (await getSetting(DB, 'email_register_enabled', '1')) !== '1') {
      return error('注册已暂停，暂不接受新注册', 403, 'register_paused');
    }

    const hit = await bump(DB, `otp:verify:${email}:${purpose}`, 5, 900);
    if (!hit.ok) return tooMany(hit.retryAfter);

    const row = await consumeEmailCode(DB, { email, purpose, code });
    if (!row) return error('验证码错误或已过期', 400, 'invalid_code');

    if (purpose === 'register') {
      const nickname = String(body.nickname || '').trim();
      const password = String(body.password || '');
      if (!isValidNickname(nickname)) return error('昵称需为 1-20 个字符', 400, 'invalid_nickname');
      if (!isValidPassword(password)) return error(passwordRuleText(), 400, 'invalid_password');

      const takenEmail = await DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
      if (takenEmail) return error('该邮箱已注册，请直接登录', 409, 'email_taken');
      const takenName = await DB.prepare('SELECT 1 FROM users WHERE nickname = ?').bind(nickname).first();
      if (takenName) return error('昵称已被占用，换一个吧', 409, 'nickname_taken');

      const id = uuid();
      const hash = await hashPassword(password);
      const color = await assignColor(DB);
      await DB.prepare(
        `INSERT INTO users (id, nickname, color, email, email_verified, password_hash, status)
         VALUES (?, ?, ?, ?, 1, ?, 'active')`,
      ).bind(id, nickname, color, email, hash).run();

      const user = await getUserById(DB, id);
      const { session, me } = await finishPasswordLogin(DB, user, request, 'email_otp');
      return json({ ok: true, data: me }, 201, { 'Set-Cookie': sessionCookie(session.token, secure(request)) });
    }

    if (purpose === 'login') {
      const user = await DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
      if (!user || user.status !== 'active' || !user.email_verified) {
        return error('验证码错误或已过期', 400, 'invalid_code');
      }
      const { session, me } = await finishPasswordLogin(DB, user, request, 'email_otp');
      return json({ ok: true, data: me }, 200, { 'Set-Cookie': sessionCookie(session.token, secure(request)) });
    }

    // reset_password
    const user = await DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
    if (!user || user.status !== 'active') return error('验证码错误或已过期', 400, 'invalid_code');
    const newPassword = String(body.new_password || '');
    if (!isValidPassword(newPassword)) return error(passwordRuleText(), 400, 'invalid_password');
    if ((await verifyPassword(newPassword, user.password_hash)).ok) {
      return error('新密码不能与原密码相同', 400, 'same_password');
    }
    const hash = await hashPassword(newPassword);
    await DB.prepare("UPDATE users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(hash, user.id).run();
    await revokeAllSessions(DB, user.id);
    return json({ ok: true });
  }

  // 登录设备
  if (method === 'GET' && path === '/api/sessions') {
    const session = await getSession(DB, request);
    if (!session) return unauthorized();
    const rows = await DB.prepare(
      `SELECT id, user_agent, login_method, created_at, last_seen_at
         FROM user_sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        ORDER BY COALESCE(last_seen_at, created_at) DESC`,
    ).bind(session.userId).all();
    const sessions = (rows.results || []).map((r) => ({
      id: r.id,
      device: describeDevice(r.user_agent),
      login_method: r.login_method,
      created_at: r.created_at,
      last_seen_at: r.last_seen_at,
      current: r.id === session.id,
    }));
    return withSessionCookie(json({ sessions }), request, session);
  }

  if (method === 'POST' && path === '/api/sessions/revoke') {
    const blocked = guard(request);
    if (blocked) return blocked;
    const session = await getSession(DB, request);
    if (!session) return unauthorized();
    const body = await readJson(request);
    const id = String(body.id || '');
    if (!id || id === session.id) return error('会话不存在', 404, 'not_found');
    const ok = await revokeSession(DB, id, session.userId);
    if (!ok) return error('会话不存在', 404, 'not_found');
    return json({ ok: true });
  }

  if (method === 'POST' && path === '/api/sessions/revoke-others') {
    const blocked = guard(request);
    if (blocked) return blocked;
    const session = await getSession(DB, request);
    if (!session) return unauthorized();
    const revoked = await revokeOtherSessions(DB, session.userId, session.id);
    return json({ ok: true, revoked });
  }

  // 已授权应用
  if (method === 'GET' && path === '/api/clients') {
    const session = await getSession(DB, request);
    if (!session) return unauthorized();
    const rows = await DB.prepare(
      `SELECT g.client_id, g.first_authorized_at, g.last_authorized_at, g.revoked_at,
              c.client_name, c.status
         FROM oauth_grants g
         JOIN oauth_clients c ON c.client_id = g.client_id
        WHERE g.user_id = ?
        ORDER BY g.last_authorized_at DESC`,
    ).bind(session.userId).all();
    const clients = (rows.results || []).map((r) => ({
      id: r.client_id,
      name: r.client_name,
      origin: null,
      homepage: null,
      unregistered: false,
      revoked: !!r.revoked_at,
      status: r.status,
      session_count: 0,
      last_seen_at: r.last_authorized_at,
      first_authorized_at: r.first_authorized_at,
    }));
    return withSessionCookie(json({ clients }), request, session);
  }

  if (method === 'POST' && path === '/api/clients/revoke') {
    const blocked = guard(request);
    if (blocked) return blocked;
    const session = await getSession(DB, request);
    if (!session) return unauthorized();
    const body = await readJson(request);
    const clientId = String(body.id || '');
    const res = await DB.prepare(
      "UPDATE oauth_grants SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND client_id = ? AND revoked_at IS NULL",
    ).bind(session.userId, clientId).run();
    if (res.meta.changes !== 1) return error('授权不存在', 404, 'not_found');
    return json({ ok: true });
  }

  return error('接口不存在', 404, 'not_found');
}

// ---------------------------------------------------------------------------
// /auth/direct（自有服务端）
// ---------------------------------------------------------------------------
async function handleDirect(request, env) {
  if (request.method !== 'POST') return error('方法不允许', 405, 'method_not_allowed');
  const DB = env.DB;
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Basic ')) return error('invalid_client', 401, 'invalid_client');

  let clientId = '';
  let secret = '';
  try {
    const decoded = atob(auth.slice(6).trim());
    const i = decoded.indexOf(':');
    if (i < 0) throw new Error('bad basic');
    clientId = decoded.slice(0, i);
    secret = decoded.slice(i + 1);
  } catch {
    return error('invalid_client', 401, 'invalid_client');
  }

  const ip = clientIp(request) || 'unknown';
  const hit = await bump(DB, `direct:${clientId}:${ip}`, 10, 900);
  if (!hit.ok) return tooMany(hit.retryAfter);

  const client = await DB.prepare('SELECT * FROM api_clients WHERE client_id = ?').bind(clientId).first();
  if (!client || client.status !== 'active') {
    await delay(300);
    return error('invalid_client', 401, 'invalid_client');
  }
  const hash = await sha256Hex(secret);
  if (!timingSafeEqual(hash, String(client.client_secret_hash))) {
    await delay(300);
    return error('invalid_client', 401, 'invalid_client');
  }

  const ct = request.headers.get('Content-Type') || '';
  if (!ct.toLowerCase().startsWith('application/json')) {
    return error('请求格式不正确', 415, 'unsupported_media_type');
  }
  const body = await readJson(request);
  const account = String(body.account || body.email || '').trim();
  const password = String(body.password || '');
  if (!account || !password) return error('invalid_credentials', 401, 'invalid_credentials');

  const user = await findUserByAccount(DB, account);
  if (!user || user.status !== 'active' || !(await verifyPassword(password, user.password_hash)).ok) {
    await delay(300);
    return error('invalid_credentials', 401, 'invalid_credentials');
  }

  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(client.access_token_ttl) > 0 ? Number(client.access_token_ttl) : 3600;
  const accessToken = await signJwt({
    iss: env.ISSUER,
    sub: user.id,
    aud: client.client_id,
    scope: client.allowed_scopes,
    token_use: 'access',
    iat: now,
    exp: now + ttl,
    jti: uuid(),
  }, env);

  await DB.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").bind(user.id).run();
  await DB.prepare('INSERT INTO login_log (user_id, method, client_id, ip) VALUES (?, ?, ?, ?)')
    .bind(user.id, 'direct', client.client_id, clientIp(request) || null).run();

  return json({ access_token: accessToken, token_type: 'Bearer', expires_in: ttl });
}

// ---------------------------------------------------------------------------
// 安全头 / 缓存
// ---------------------------------------------------------------------------
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://cravatar.com",
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function withSecurityHeaders(response, url) {
  if (!(response instanceof Response)) return response;
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  const ct = headers.get('Content-Type') || '';
  if (ct.includes('text/html')) {
    headers.set('Content-Security-Policy', CSP);
    headers.set('Cache-Control', 'no-cache');
  } else if (/\.(css|js|webp|png|jpg|jpeg|svg|ico|txt)$/i.test(url.pathname)) {
    headers.set('Cache-Control', 'public, max-age=300, must-revalidate');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ---------------------------------------------------------------------------
// Cron 清理
// ---------------------------------------------------------------------------
async function cleanup(DB) {
  await DB.batch([
    DB.prepare("DELETE FROM oauth_authorization_codes WHERE expires_at < CURRENT_TIMESTAMP"),
    DB.prepare("DELETE FROM email_verification_codes WHERE expires_at < CURRENT_TIMESTAMP"),
    DB.prepare("DELETE FROM rate_limits WHERE expires_at < CURRENT_TIMESTAMP"),
    DB.prepare("DELETE FROM user_sessions WHERE expires_at < datetime('now', '-7 days') OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', '-7 days'))"),
    DB.prepare("DELETE FROM login_log WHERE created_at < datetime('now', '-90 days')"),
  ]);
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------
async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  // OIDC
  if (path === '/.well-known/openid-configuration' && request.method === 'GET') {
    return handleDiscovery(env);
  }
  if (path === '/jwks' && request.method === 'GET') return handleJwks(env);
  if (path === '/authorize' && (request.method === 'GET' || request.method === 'POST')) {
    return handleAuthorize(request, env);
  }
  if (path === '/token' && request.method === 'POST') return handleToken(request, env);
  if (path === '/userinfo') return handleUserinfo(request, env);

  // 自有服务端
  if (path === '/auth/direct') return handleDirect(request, env);

  // 本站 API
  if (path.startsWith('/api/')) return handleApi(request, env, url);

  // 静态资源
  if (!env.ASSETS) return text('静态资源未配置', 500);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      const response = await route(request, env);
      return withSecurityHeaders(response, url);
    } catch (e) {
      console.error('unhandled error:', e && e.stack ? e.stack : e);
      return withSecurityHeaders(json({ error: '服务器内部错误', code: 'internal_error' }, 500), url);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(cleanup(env.DB));
  },
};
