// Qxwk-Account 通行证 · Worker 入口
// 一个 Worker 同时处理 /api/* 接口和静态资源（public/）
import {
  json, error,
  hashPassword, verifyPassword, createSession, getUserId, assignColor,
  isValidNickname, isValidPassword, getAvatarUrl,
  genEmailCode, sendEmail, renderResetEmail, renderBrandEmail,
  USER_COLORS,
} from './lib.js';

// ---------- CORS（白名单回显，供各站跨域验证 token） ----------
// 对带 Origin 的请求查 apps 表白名单：命中才回显 Access-Control-Allow-Origin
async function corsHeaders(env, request, res) {
  const origin = request.headers.get('Origin');
  if (!origin) return res; // 同源/无浏览器上下文
  const hit = await env.DB.prepare('SELECT 1 FROM apps WHERE origin = ?').bind(origin).first();
  if (!hit) return res;    // 未注册域不加头，浏览器天然拦截
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Vary', 'Origin');
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// 校验 SSO 回调 redirect：必须是合法 http/https URL，且 origin 命中 apps 白名单
// 未命中也返回 200（前端按「未接入警告」处理，不自动跳转），拒绝才算错
async function getSsoInfo(DB, redirect) {
  let url;
  try { url = new URL(redirect); } catch { return { ok: false, reason: 'redirect 不是合法 URL' }; }
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return { ok: false, reason: '仅支持 http/https 链接' };
  }
  const app = await DB.prepare('SELECT id, name, homepage FROM apps WHERE origin = ?')
    .bind(url.origin).first();
  if (!app) return { ok: false, reason: '该站点未接入 Qxwk 通行证' };
  const base = url.origin + url.pathname;
  return { ok: true, appId: app.id, appName: app.name, appHomepage: app.homepage, base };
}

// 生成一次性邀请码：8 位，去易混淆字符（I/O/0/1），32 字符表可整除 256 → 无偏
function generateInviteCode() {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[bytes[i] % ALPHABET.length];
  return code;
}

// 读取系统设置（settings 键值表），无记录时返回默认值
async function getSetting(DB, key, def) {
  const row = await DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : def;
}

// ---------- API 处理 ----------

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const DB = env.DB;

  // POST /api/register（邀请码可配置：invite_code_required=1 时需一次性邀请码）
  if (method === 'POST' && path === '/api/register') {
    const body = await request.json().catch(() => ({}));
    const nickname = String(body.nickname || '').trim();
    const password = String(body.password || '');
    const inviteCode = String(body.invite_code || '').trim();

    if (!isValidNickname(nickname)) return error('昵称需为 1-20 个字符');
    if (!isValidPassword(password)) return error('密码需为 4-50 个字符');
    if ((await getSetting(DB, 'invite_register_enabled', '1')) !== '1') return error('注册已暂停，暂不接受新注册', 403);
    const inviteRequired = (await getSetting(DB, 'invite_code_required', '1')) === '1';

    const existing = await DB.prepare('SELECT id FROM users WHERE nickname = ?').bind(nickname).first();
    if (existing) return error('昵称已被占用，换一个吧', 409);

    // invite_code_required=1 时原子消耗一次性邀请码（用后即焚，防止并发重复使用）
    if (inviteRequired) {
      if (!inviteCode) return error('请填写邀请码');
      const consume = await DB.prepare(
        `UPDATE invite_codes SET used_at = datetime('now'), used_by = NULL
         WHERE code = ? AND used_at IS NULL`
      ).bind(inviteCode).run();
      if (consume.meta.changes === 0) return error('邀请码无效或已被使用', 403);
    }

    const passwordHash = await hashPassword(password);
    const color = await assignColor(DB);
    const res = await DB.prepare('INSERT INTO users (nickname, password_hash, color) VALUES (?, ?, ?)')
      .bind(nickname, passwordHash, color).run();
    const userId = res.meta.last_row_id;
    // 回填实际用户 id
    if (inviteRequired) {
      await DB.prepare('UPDATE invite_codes SET used_by = ? WHERE code = ?')
        .bind(userId, inviteCode).run();
    }
    const token = await createSession(DB, userId);
    return json({ token, userId, nickname, color, created_at: new Date().toISOString() }, 201);
  }

  // GET /api/config（公开：注册配置，供前端决定是否显示邀请码输入框）
  if (method === 'GET' && path === '/api/config') {
    const inviteCodeRequired = (await getSetting(DB, 'invite_code_required', '1')) === '1';
    const inviteGenerateEnabled = (await getSetting(DB, 'invite_generate_enabled', '1')) === '1';
    const inviteRegisterEnabled = (await getSetting(DB, 'invite_register_enabled', '1')) === '1';
    return json({ inviteCodeRequired, inviteGenerateEnabled, inviteRegisterEnabled });
  }

  // GET /api/invite-code（登录用户：有未使用码直接返回，无则生成一个；一码制，防止生成过多）
  if (method === 'GET' && path === '/api/invite-code') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    if ((await getSetting(DB, 'invite_generate_enabled', '1')) !== '1') {
      return json({ paused: true, code: null });
    }
    // 1) 查该用户未使用的邀请码（一码制：已有未使用码则直接返回，取最旧的一条）
    let row = await DB.prepare(
      'SELECT code FROM invite_codes WHERE used_at IS NULL AND created_by = ? ORDER BY rowid ASC LIMIT 1'
    ).bind(userId).first();
    // 2) 没有则生成一个（写入 created_by 记录生成人，便于溯源）
    if (!row) {
      let code = generateInviteCode();
      let inserted = false;
      for (let i = 0; i < 5 && !inserted; i++) {
        try {
          await DB.prepare('INSERT INTO invite_codes (code, created_by) VALUES (?, ?)')
            .bind(code, userId).run();
          inserted = true;
        } catch (e) {
          code = generateInviteCode(); // 撞码（PRIMARY KEY 冲突）时换一个重试
        }
      }
      if (!inserted) return error('邀请码生成失败，请重试', 500);
      row = { code };
    }
    return json({ paused: false, code: row.code });
  }

  // POST /api/login（可选 client_id：来源站点，写入 login_log）
  if (method === 'POST' && path === '/api/login') {
    const body = await request.json().catch(() => ({}));
    const account = String(body.nickname || body.account || '').trim();
    const password = String(body.password || '');
    const clientId = Number(body.client_id) || null;
    if (!account) return error('请填写昵称或邮箱');

    // 昵称优先：先按昵称精确匹配；未命中再按邮箱（忽略大小写）匹配
    const user = await DB.prepare('SELECT * FROM users WHERE nickname = ?').bind(account).first()
      || await DB.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').bind(account).first();
    if (!user) return error('帐号或密码不正确', 401);
    // 密码哈希为空：账号已建但未设密码，要求设置密码（不在此处泄露密码是否正确）
    if (!user.password_hash) {
      return json({ need_set_password: true, identity: user.nickname });
    }
    if (!password) return error('请填写密码');
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return error('帐号或密码不正确', 401);

    const token = await createSession(DB, user.id);
    // 登录来源日志（client_id 来自 SSO 流程）
    await DB.prepare('INSERT INTO login_log (user_id, client_id) VALUES (?, ?)')
      .bind(user.id, clientId).run();
    return json({ token, userId: user.id, nickname: user.nickname, color: user.color, email: user.email, avatar: getAvatarUrl(user.email), created_at: user.created_at });
  }

  // POST /api/set-password（账号密码哈希为空时，首次设置密码并登录）
  if (method === 'POST' && path === '/api/set-password') {
    const body = await request.json().catch(() => ({}));
    const nickname = String(body.nickname || '').trim();
    const newPassword = String(body.new_password || '');
    if (!nickname) return error('请填写昵称');
    if (!isValidPassword(newPassword)) return error('密码需为 4-50 个字符');
    const user = await DB.prepare('SELECT id, nickname, color, email, password_hash, created_at FROM users WHERE nickname = ?').bind(nickname).first();
    if (!user) return error('用户不存在', 401);
    // 仅允许密码哈希为空的账号走此口子（已设密码的请走 /api/password）
    if (user.password_hash) return error('该账号已设置密码，请直接登录', 409);
    const passwordHash = await hashPassword(newPassword);
    await DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, user.id).run();
    const token = await createSession(DB, user.id);
    await DB.prepare('INSERT INTO login_log (user_id, client_id) VALUES (?, ?)')
      .bind(user.id, null).run();
    return json({ token, userId: user.id, nickname: user.nickname, color: user.color, email: user.email, avatar: getAvatarUrl(user.email), created_at: user.created_at });
  }

  // GET /api/me（登录：验证 token 有效性，供各站跨域调用；含 email 及 avatar 头像链接）
  if (method === 'GET' && path === '/api/me') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    const user = await DB.prepare('SELECT id, nickname, color, email, email_verified, created_at FROM users WHERE id = ?').bind(userId).first();
    if (!user) return error('用户不存在', 401);
    return json({ userId: user.id, nickname: user.nickname, color: user.color, email: user.email, email_verified: !!user.email_verified, avatar: getAvatarUrl(user.email), created_at: user.created_at });
  }

  // PUT /api/profile（登录：修改个人资料。可改昵称/颜色/邮箱）
  if (method === 'PUT' && path === '/api/profile') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);

    const body = await request.json().catch(() => ({}));
    const user = await DB.prepare('SELECT id, nickname, color, email, created_at FROM users WHERE id = ?').bind(userId).first();
    if (!user) return error('用户不存在', 401);

    let nickname = user.nickname;
    let color = user.color;
    let email = user.email;

    // 昵称：1-20 字符，且与其他用户不冲突（自己原昵称跳过唯一性校验）
    if (Object.prototype.hasOwnProperty.call(body, 'nickname')) {
      const raw = String(body.nickname || '').trim();
      if (!isValidNickname(raw)) return error('昵称需为 1-20 个字符');
      if (raw !== user.nickname) {
        const clash = await DB.prepare('SELECT 1 FROM users WHERE nickname = ? AND id != ?').bind(raw, userId).first();
        if (clash) return error('昵称已被占用，换一个吧', 409);
        nickname = raw;
      }
    }
    // 颜色：必须在 60 色池内
    if (Object.prototype.hasOwnProperty.call(body, 'color')) {
      if (typeof body.color !== 'string' || !USER_COLORS.includes(body.color)) {
        return error('颜色无效，请从预置色板中选择');
      }
      color = body.color;
    }
    // 邮箱：空串→清空为 null；非空则必须为合法邮箱地址（不限服务商）
    if (Object.prototype.hasOwnProperty.call(body, 'email')) {
      const raw = typeof body.email === 'string' ? body.email.trim() : '';
      if (raw === '') {
        email = null;
      } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        return error('请输入正确的邮箱地址');
      } else {
        email = raw;
      }
    }

    // 邮箱若发生变更，需重新验证 → 重置 email_verified=0（含清空邮箱）
    const emailChanged = email !== user.email;
    await DB.prepare('UPDATE users SET nickname = ?, color = ?, email = ? WHERE id = ?')
      .bind(nickname, color, email, userId).run();
    if (emailChanged) {
      await DB.prepare('UPDATE users SET email_verified = 0 WHERE id = ?').bind(userId).run();
    }

    return json({
      userId: user.id, nickname, color, email, avatar: getAvatarUrl(email), created_at: user.created_at,
    });
  }

  // POST /api/email/send-code（登录：发送验证码到指定 QQ 邮箱，绑定邮箱时调用）
  if (method === 'POST' && path === '/api/email/send-code') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    if (!env.EMAIL_API_KEY) return error('邮件服务未配置，请联系管理员', 503);
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('请输入正确的邮箱地址');

    // 防刷：60 秒内同邮箱仍有未使用验证码则直接拒绝
    const recent = await DB.prepare(
      `SELECT 1 FROM email_codes WHERE email = ? AND used_at IS NULL
       AND expires_at > datetime('now')
       AND created_at > datetime('now', '-1 minute')`
    ).bind(email).first();
    if (recent) return error('发送太频繁，请稍后再试', 429);

    const code = genEmailCode();
    // 一码制：先删该用户此用途的旧码再插入新码（时间跨度 >1 分钟的旧码也清干净）
    await DB.prepare("DELETE FROM email_codes WHERE user_id = ? AND purpose = 'verify'").bind(userId).run();
    await DB.prepare(
      `INSERT INTO email_codes (user_id, email, code, purpose, expires_at)
       VALUES (?, ?, ?, 'verify', datetime('now', '+10 minutes'))`
    ).bind(userId, email, code).run();

    try {
      await sendEmail(env, email, 'Qxwk 通行证 · 邮箱验证码', renderBrandEmail({
        eyebrow: 'Qxwk 通行证', title: '邮箱验证码',
        intro: '你好，这是一封用于绑定邮箱的验证邮件。请在页面输入下方 6 位验证码完成验证：',
        code,
      }));
    } catch (e) {
      return error('邮件发送失败，请稍后重试', 502);
    }
    return json({ ok: true });
  }

  // POST /api/email/verify（登录：校验验证码，通过后绑定邮箱并标记已验证）
  if (method === 'POST' && path === '/api/email/verify') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim();
    const code = String(body.code || '').trim();

    // 不区分「码不存在/过期/已用」，统一报错，防枚举
    const row = await DB.prepare(
      `SELECT id FROM email_codes WHERE user_id = ? AND email = ? AND purpose = 'verify'
       AND code = ? AND used_at IS NULL AND expires_at > datetime('now')`
    ).bind(userId, email, code).first();
    if (!row) return error('验证码错误或已过期', 400);

    // 原子标记已用（用后即焚），并发重放时第二个请求到此会失败
    const done = await DB.prepare(
      `UPDATE email_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`
    ).bind(row.id).run();
    if (done.meta.changes === 0) return error('验证码错误或已过期', 400);

    // 绑定邮箱并标记已验证（唯一索引冲突说明该邮箱已被他人绑定）
    try {
      await DB.prepare('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?')
        .bind(email, userId).run();
    } catch (e) {
      return error('该邮箱已被其他账号绑定', 409);
    }
    return json({ ok: true, email });
  }

  // POST /api/forgot-send（无需登录：向已绑定且已验证的邮箱发送密码重置验证码；未知/未验证邮箱返回最少信息文案）
  if (method === 'POST' && path === '/api/forgot-send') {
    if (!env.EMAIL_API_KEY) return error('邮件服务未配置，请联系管理员', 503);
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('请输入正确的邮箱地址');

    const user = await DB.prepare('SELECT id, email_verified FROM users WHERE LOWER(email) = LOWER(?)')
      .bind(email).first();
    // 未知邮箱 / 未验证：返回最少信息文案
    if (!user || !user.email_verified) {
      return error('该邮箱未验证', 400);
    }
    const recent = await DB.prepare(
      `SELECT 1 FROM email_codes WHERE email = ? AND purpose = 'reset' AND used_at IS NULL
       AND expires_at > datetime('now') AND created_at > datetime('now', '-1 minute')`
    ).bind(email).first();
    if (!recent) {
      const code = genEmailCode();
      // 一码制：清掉该用户此用途旧码再插入新码
      await DB.prepare("DELETE FROM email_codes WHERE user_id = ? AND purpose = 'reset'").bind(user.id).run();
      await DB.prepare(
        `INSERT INTO email_codes (user_id, email, code, purpose, expires_at)
         VALUES (?, ?, ?, 'reset', datetime('now', '+10 minutes'))`
      ).bind(user.id, email, code).run();
      try {
        await sendEmail(env, email, 'Qxwk 通行证 · 重置密码', renderResetEmail(code));
      } catch (e) {
        // 已注册且已验证但真实发送失败：明确报错，方便用户重试
        return error('邮件发送失败，请稍后重试', 502);
      }
    }
    return json({ ok: true, msg: '验证码已发送，请查收邮箱' });
  }

  // POST /api/forgot-reset（无需登录：校验重置码，通过后设置新密码并登录；旧会话随 createSession 轮换失效）
  if (method === 'POST' && path === '/api/forgot-reset') {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim();
    const code = String(body.code || '').trim();
    const newPassword = String(body.new_password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('请输入正确的邮箱地址');
    if (!code) return error('请输入验证码');
    if (!isValidPassword(newPassword)) return error('新密码需为 4-50 个字符');
    if (newPassword !== String(body.new_password_confirm || '')) return error('两次输入的密码不一致');

    const user = await DB.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').bind(email).first();
    // 未知邮箱/未验证邮箱统一报同一错误，防枚举
    if (!user || !user.email_verified) return error('验证码错误或已过期', 400);

    const row = await DB.prepare(
      `SELECT id FROM email_codes WHERE user_id = ? AND email = ? AND purpose = 'reset'
       AND code = ? AND used_at IS NULL AND expires_at > datetime('now')`
    ).bind(user.id, email, code).first();
    if (!row) return error('验证码错误或已过期', 400);

    // 原子消耗（用后即焚）
    const done = await DB.prepare(
      `UPDATE email_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`
    ).bind(row.id).run();
    if (done.meta.changes === 0) return error('验证码错误或已过期', 400);

    // 更新密码 + 轮换会话（createSession 会删除该用户旧会话，重置后他处登录被登出）
    const passwordHash = await hashPassword(newPassword);
    await DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, user.id).run();
    const token = await createSession(DB, user.id);
    return json({
      token, userId: user.id, nickname: user.nickname, color: user.color,
      email: user.email, avatar: getAvatarUrl(user.email), created_at: user.created_at,
    });
  }

  // PUT /api/password（登录：修改密码。凭 Bearer 会话直接改，新密码 4-50 字符）
  if (method === 'PUT' && path === '/api/password') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    const body = await request.json().catch(() => ({}));
    const newPassword = String(body.new_password || '');
    if (!newPassword) return error('请填写新密码');
    if (!isValidPassword(newPassword)) return error('新密码需为 4-50 个字符');
    const passwordHash = await hashPassword(newPassword);
    await DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, userId).run();
    return json({ ok: true });
  }

  // POST /api/logout（登录：撤销当前会话，幂等）
  if (method === 'POST' && path === '/api/logout') {
    const auth = request.headers.get('Authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (token) await DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return json({ ok: true });
  }

  // GET /api/sso/info?redirect=<url>（SSO 前置校验：来源站点 + redirect 合法性）
  if (method === 'GET' && path === '/api/sso/info') {
    const info = await getSsoInfo(DB, url.searchParams.get('redirect') || '');
    return json(info);
  }

  // GET /api/login-log（登录：最近登录来源，用户中心展示）
  if (method === 'GET' && path === '/api/login-log') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    const logs = await DB.prepare(
      `SELECT ll.created_at, a.name AS app_name, a.homepage
       FROM login_log ll LEFT JOIN apps a ON ll.client_id = a.id
       WHERE ll.user_id = ? ORDER BY ll.id DESC LIMIT 5`
    ).bind(userId).all();
    return json({ logs: logs.results });
  }

  return null; // 不是已知 API 路由
}

// ---------- 入口 ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS 预检（OPTIONS）
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (!origin) return new Response(null, { status: 403 });
      const hit = await env.DB.prepare('SELECT 1 FROM apps WHERE origin = ?').bind(origin).first();
      if (!hit) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Vary': 'Origin',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // API 路由
    if (url.pathname.startsWith('/api/')) {
      const result = await handleApi(request, env);
      return corsHeaders(env, request, result || json({ error: '接口不存在' }, 404));
    }

    // 其余：静态资源（public/），并同步 CORS 头
    const res = await env.ASSETS.fetch(request);
    return corsHeaders(env, request, res);
  },
};