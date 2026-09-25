// Qxwk-Account 通行证 · Worker 入口
// 一个 Worker 同时处理 /api/* 接口和静态资源（public/）
import {
  json, error,
  hashPassword, verifyPassword, createSession, getUserId, assignColor,
  isValidNickname, isValidPassword, getAvatarUrl,
  genEmailCode, sendEmail, renderResetEmail, renderBrandEmail,
  USER_COLORS, getToken, describeDevice, revokeAllSessions, resolveClient,
  loginLockRemaining, recordLoginFail, clearLoginFails, resolveSession, getSessionKey,
} from './lib.js';

// ---------- CORS（全面放行：任意 Origin 都可跨域调用，鉴权靠 Bearer token） ----------
// 对带 Origin 的请求回显 Access-Control-Allow-Origin
async function corsHeaders(request, res) {
  const origin = request.headers.get('Origin');
  if (!origin) return res; // 同源/无浏览器上下文
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Vary', 'Origin');
  // Allow-Methods 必须把实际用到的动词列全：改资料/改密码是 PUT，漏了会让跨域预检直接失败
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
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
    // 来源站点：显式 body.client 优先，否则读 Origin 头；必须在 apps 白名单内才记录（见 lib.js resolveClient）
    const clientId = await resolveClient(DB, request, body.client);
    const token = await createSession(DB, userId, request.headers.get('User-Agent'), clientId);
    // 与登录保持同一响应字段（新注册无邮箱 → email/avatar 均为 null），避免前端两处处理分支
    return json({ token, userId, nickname, color, email: null, avatar: null, created_at: new Date().toISOString() }, 201);
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

  // POST /api/login（登录；body 带 new_password 时，空哈希账号一并首次设密并登录——原独立的 /api/set-password 已合并至此）
  if (method === 'POST' && path === '/api/login') {
    const body = await request.json().catch(() => ({}));
    const account = String(body.nickname || body.account || '').trim();
    const password = String(body.password || '');
    // 仅「空哈希账号」（管理员预建/导入）用得到；已设密码的账号会忽略它，改密走 /api/password、重置走 /api/email/verify
    const newPassword = String(body.new_password || '');
    if (!account) return error('请填写昵称或邮箱');

    // 失败限流：锁定期内直接 429（见 lib.js 顶部说明）。
    // 这里只回报剩余时间、不区分账号是否存在，配合「失败一律计数」避免账号枚举
    const accountKey = account.toLowerCase();
    const lockSec = await loginLockRemaining(DB, accountKey);
    if (lockSec > 0) {
      return error('登录失败次数过多，请 ' + Math.ceil(lockSec / 60) + ' 分钟后再试', 429);
    }

    // 昵称优先：先按昵称精确匹配；未命中再按邮箱（忽略大小写）匹配
    const user = await DB.prepare('SELECT * FROM users WHERE nickname = ?').bind(account).first()
      || await DB.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').bind(account).first();
    if (!user) {
      await recordLoginFail(DB, accountKey);
      return error('帐号或密码不正确', 401);
    }

    if (!user.password_hash) {
      // 空哈希账号：没带 new_password 就返回引导标记（不在此处泄露密码是否正确），带了就设密后直接登录
      if (!newPassword) return json({ need_set_password: true, identity: user.nickname });
      if (!isValidPassword(newPassword)) return error('密码需为 4-50 个字符');
      const passwordHash = await hashPassword(newPassword);
      await DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, user.id).run();
    } else {
      if (!password) return error('请填写密码');
      const ok = await verifyPassword(password, user.password_hash);
      if (!ok) {
        await recordLoginFail(DB, accountKey);
        return error('帐号或密码不正确', 401);
      }
    }

    await clearLoginFails(DB, accountKey); // 登录成功：清掉失败记录
    // 来源站点：显式 body.client 优先，否则读 Origin 头；必须在 apps 白名单内才记录（见 lib.js resolveClient）
    const clientId = await resolveClient(DB, request, body.client);
    const token = await createSession(DB, user.id, request.headers.get('User-Agent'), clientId);
    // 登录日志：记下来源站点（client_id），账号中心「最近登录记录」据此显示站点名；未登记的来源为 NULL → 显示「直接访问」
    await DB.prepare('INSERT INTO login_log (user_id, client_id) VALUES (?, ?)').bind(user.id, clientId).run();
    return json({ token, userId: user.id, nickname: user.nickname, color: user.color, email: user.email, avatar: await getAvatarUrl(user.email), created_at: user.created_at });
  }

  // GET /api/me（登录：验证 token 有效性，供各站跨域调用；含 email 及 avatar 头像链接）
  if (method === 'GET' && path === '/api/me') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    const user = await DB.prepare('SELECT id, nickname, color, email, email_verified, created_at FROM users WHERE id = ?').bind(userId).first();
    if (!user) return error('用户不存在', 401);
    return json({ userId: user.id, nickname: user.nickname, color: user.color, email: user.email, email_verified: !!user.email_verified, avatar: await getAvatarUrl(user.email), created_at: user.created_at });
  }

  // POST /api/verify（公开：第三方站点/App 校验 token 是否有效）
  // token 来源：body {token} 优先（服务端调用方便），其次 Authorization: Bearer（浏览器场景）
  // 无效 token 返回 200 + {valid:false}：下游用字段判断即可，不必先处理状态码分支
  // 与 GET /api/me 的区别：本接口是「校验 + 归属」，额外返回 client（该 token 是哪个站点带来的）；
  // 且**不**滚动更新 last_seen_at、不写登录日志——站点后端可能高频轮询，不该污染活跃时间与登录记录
  // 只回最小信息 {valid, userId, client}：调用方真正需要的只有「这个 token 属于哪个 userId」，
  // 昵称/邮箱/头像等资料一律不回（token 一旦泄露，泄露者也不该顺带拿到用户的邮箱）；要资料请自带 Bearer 调 /api/me
  if (method === 'POST' && path === '/api/verify') {
    const body = await request.json().catch(() => ({}));
    const raw = String(body.token || '').trim() || getToken(request);
    if (!raw) return json({ valid: false });
    // 用 resolveSession 而非直接按哈希查：老明文会话在这里也会被识别并就地迁移（见 lib.js）
    const s = await resolveSession(DB, raw);
    if (!s) return json({ valid: false });
    // 用户已不存在时同样视为无效（会话行可能残留）
    const alive = await DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(s.userId).first();
    if (!alive) return json({ valid: false });
    const client = s.clientId
      ? await DB.prepare('SELECT id, name, origin, homepage FROM apps WHERE id = ?').bind(s.clientId).first()
      : null;
    return json({ valid: true, userId: s.userId, client: client || null });
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
      userId: user.id, nickname, color, email, avatar: await getAvatarUrl(email), created_at: user.created_at,
    });
  }

  // POST /api/email/code（发送邮箱验证码；由原 /api/email/send-code 与 /api/forgot-send 合并而来）
  // purpose = 'verify'（默认，绑定邮箱）：需登录，可明确报错
  // purpose = 'reset'（找回密码）：无需登录，且错误文案必须模糊（见下方 60 秒限发的处理）
  if (method === 'POST' && path === '/api/email/code') {
    if (!env.EMAIL_API_KEY) return error('邮件服务未配置，请联系管理员', 503);
    const body = await request.json().catch(() => ({}));
    const purpose = body.purpose === 'reset' ? 'reset' : 'verify';
    const email = String(body.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('请输入正确的邮箱地址');

    // 验证码归属用户：verify 取当前登录用户；reset 按邮箱反查并要求已绑定且已验证
    let userId;
    if (purpose === 'verify') {
      userId = await getUserId(DB, request);
      if (!userId) return error('未登录', 401);
    } else {
      const owner = await DB.prepare('SELECT id, email_verified FROM users WHERE LOWER(email) = LOWER(?)')
        .bind(email).first();
      // 未知邮箱 / 未验证邮箱返回最少信息文案（防账户枚举）
      if (!owner || !owner.email_verified) return error('该邮箱未验证', 400);
      userId = owner.id;
    }

    // 防刷：60 秒内同邮箱同用途仍有未使用且未过期的码
    const recent = await DB.prepare(
      `SELECT 1 FROM email_codes WHERE email = ? AND purpose = ? AND used_at IS NULL
       AND expires_at > datetime('now') AND created_at > datetime('now', '-1 minute')`
    ).bind(email, purpose).first();
    if (recent) {
      // reset 场景必须静默成功：若返回 429，攻击者就能用「429 vs 400」区分邮箱是否已注册，防枚举失效
      if (purpose === 'reset') return json({ ok: true, msg: '验证码已发送，请查收邮箱' });
      return error('发送太频繁，请稍后再试', 429);
    }

    const code = genEmailCode();
    // 一码制：先删该用户此用途旧码再插入新码（顺带清掉 >1 分钟的旧码）
    await DB.prepare('DELETE FROM email_codes WHERE user_id = ? AND purpose = ?').bind(userId, purpose).run();
    await DB.prepare(
      `INSERT INTO email_codes (user_id, email, code, purpose, expires_at)
       VALUES (?, ?, ?, ?, datetime('now', '+10 minutes'))`
    ).bind(userId, email, code, purpose).run();

    try {
      if (purpose === 'reset') {
        await sendEmail(env, email, 'Qxwk 通行证 · 重置密码', renderResetEmail(code));
      } else {
        await sendEmail(env, email, 'Qxwk 通行证 · 邮箱验证码', renderBrandEmail({
          eyebrow: 'Qxwk 通行证', title: '邮箱验证码',
          intro: '你好，这是一封用于绑定邮箱的验证邮件。请在页面输入下方 6 位验证码完成验证：',
          code,
        }));
      }
    } catch (e) {
      return error('邮件发送失败，请稍后重试', 502);
    }
    return json(purpose === 'reset' ? { ok: true, msg: '验证码已发送，请查收邮箱' } : { ok: true });
  }

  // POST /api/email/verify（核销邮箱验证码；由原 /api/email/verify 与 /api/forgot-reset 合并而来）
  // 不带 new_password：绑定邮箱（需登录，purpose='verify'）
  // 带 new_password：重置密码并登录（无需登录，purpose='reset'；改密后撤销该账号全部旧会话）
  if (method === 'POST' && path === '/api/email/verify') {
    const body = await request.json().catch(() => ({}));
    const email = String(body.email || '').trim();
    const code = String(body.code || '').trim();
    const newPassword = String(body.new_password || '');
    const reset = !!newPassword; // 是否走「重置密码」分支，由是否提供新密码决定（重置必然要改密码）
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error('请输入正确的邮箱地址');
    if (!code) return error('请输入验证码');

    // 定位归属用户：绑定走当前登录态；重置按邮箱反查（未知/未验证邮箱统一模糊报错，防枚举）
    let userId;
    let owner = null;
    if (reset) {
      if (!isValidPassword(newPassword)) return error('新密码需为 4-50 个字符');
      if (newPassword !== String(body.new_password_confirm || '')) return error('两次输入的密码不一致');
      owner = await DB.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').bind(email).first();
      if (!owner || !owner.email_verified) return error('验证码错误或已过期', 400);
      userId = owner.id;
    } else {
      userId = await getUserId(DB, request);
      if (!userId) return error('未登录', 401);
    }
    const purpose = reset ? 'reset' : 'verify';

    // 不区分「码不存在/过期/已用」，统一报错，防枚举
    const row = await DB.prepare(
      `SELECT id FROM email_codes WHERE user_id = ? AND email = ? AND purpose = ?
       AND code = ? AND used_at IS NULL AND expires_at > datetime('now')`
    ).bind(userId, email, code, purpose).first();
    if (!row) return error('验证码错误或已过期', 400);

    // 原子标记已用（用后即焚），并发重放时第二个请求到此会失败
    const done = await DB.prepare(
      `UPDATE email_codes SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL`
    ).bind(row.id).run();
    if (done.meta.changes === 0) return error('验证码错误或已过期', 400);

    if (!reset) {
      // 绑定邮箱并标记已验证（唯一索引冲突说明该邮箱已被他人绑定）
      try {
        await DB.prepare('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?')
          .bind(email, userId).run();
      } catch (e) {
        return error('该邮箱已被其他账号绑定', 409);
      }
      return json({ ok: true, email });
    }

    // 重置密码：改哈希 + 撤销全部旧会话（密码被重置说明账号可能已失守，多会话下不会自动踢人，必须显式撤销）
    const passwordHash = await hashPassword(newPassword);
    await DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, owner.id).run();
    await revokeAllSessions(DB, owner.id);
    // 重置后签发的会话同样记录来源站点（若用户是在某站点里走的重置流程）
    const clientId = await resolveClient(DB, request, body.client);
    const token = await createSession(DB, owner.id, request.headers.get('User-Agent'), clientId);
    // 登录日志与 /api/login 一致（重置成功也是「一次登录」）；顺带清掉该账号的失败限流记录：
    // 用户往往正是「撞上锁定 → 走邮箱重置」进来的，不清的话他重置完仍会被锁 15 分钟登不进去
    await DB.prepare('INSERT INTO login_log (user_id, client_id) VALUES (?, ?)').bind(owner.id, clientId).run();
    await clearLoginFails(DB, String(owner.nickname || '').toLowerCase());
    if (owner.email) await clearLoginFails(DB, String(owner.email).toLowerCase());
    return json({
      token, userId: owner.id, nickname: owner.nickname, color: owner.color,
      email: owner.email, avatar: await getAvatarUrl(owner.email), created_at: owner.created_at,
    });
  }

  // PUT /api/password（登录：修改密码。凭 Bearer 会话直接改，新密码 4-50 字符）
  // 与 /api/email/verify（带 new_password 的重置分支）不同：这里只改密码，保留当前会话、也不影响其他已登录设备（用户可在「登录设备」卡自行下线）
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

  // POST /api/logout（登录：撤销当前会话，幂等；其他设备不受影响）
  // 必须走 resolveSession 取「库中实际存的键」：老明文会话在迁移前其键并不等于 sha256(token)，
  // 直接按哈希删会删不中，表现为「点了退出但还能用」
  if (method === 'POST' && path === '/api/logout') {
    const key = await getSessionKey(DB, request);
    if (key) await DB.prepare('DELETE FROM sessions WHERE token = ?').bind(key).run();
    return json({ ok: true });
  }

  // GET /api/login-log（登录：最近登录记录，展示在账号中心「登录设备」卡底部）
  // 每条带来源站点名（client_id → apps.name）；未登记来源 / 直连登录为 NULL，前端显示「直接访问」
  if (method === 'GET' && path === '/api/login-log') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    const logs = await DB.prepare(
      `SELECT ll.created_at, a.name AS app_name, ll.source_origin
       FROM login_log ll LEFT JOIN apps a ON ll.client_id = a.id
       WHERE ll.user_id = ? ORDER BY ll.id DESC LIMIT 5`
    ).bind(userId).all();
    return json({ logs: logs.results });
  }

  // GET /api/sessions（登录：本账号「直连登录」的设备，供账号中心「登录设备」卡展示）
  // 只列 client_id IS NULL 的会话（在通行证/App 上直接登录的设备）；从第三方站点带 client 来的会话
  // 一律归「已授权网站」卡（GET /api/clients），两张卡各管一类、信息不重叠
  // id 用 sessions 的 rowid：该表是普通 rowid 表，无需额外加主键列即可作为稳定的下线标识
  // 只返回 describeDevice 的展示名，不返回 token / UA 原始串（避免把可用凭证或指纹暴露给前端）
  if (method === 'GET' && path === '/api/sessions') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    // 当前会话的键由 getSessionKey 取（老明文会话会在这一步被迁移，键才与库中一致）
    const tokenKey = await getSessionKey(DB, request);
    const rows = await DB.prepare(
      `SELECT rowid AS id, token, user_agent, created_at,
              COALESCE(last_seen_at, created_at) AS last_seen_at
       FROM sessions WHERE user_id = ? AND client_id IS NULL
       ORDER BY last_seen_at DESC, rowid DESC`
    ).bind(userId).all();
    return json({
      sessions: rows.results.map((s) => ({
        id: s.id,
        device: describeDevice(s.user_agent),
        created_at: s.created_at,
        last_seen_at: s.last_seen_at,
        current: s.token === tokenKey,
      })),
    });
  }

  // POST /api/sessions/revoke（登录：下线指定设备）
  // WHERE 里同时限定 user_id：即便猜到他人的 rowid 也删不到别人的会话；当前设备不允许在此下线（否则把自己踢出去）
  if (method === 'POST' && path === '/api/sessions/revoke') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    const body = await request.json().catch(() => ({}));
    const id = Number(body.id);
    if (!Number.isInteger(id)) return error('参数无效');
    const del = await DB.prepare('DELETE FROM sessions WHERE rowid = ? AND user_id = ? AND token != ?')
      .bind(id, userId, await getSessionKey(DB, request)).run();
    if (del.meta.changes === 0) return error('设备不存在或为当前设备', 404);
    return json({ ok: true });
  }

  // POST /api/sessions/revoke-others（登录：下线除当前设备外的全部设备）
  if (method === 'POST' && path === '/api/sessions/revoke-others') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    const del = await DB.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?')
      .bind(userId, await getSessionKey(DB, request)).run();
    return json({ ok: true, revoked: del.meta.changes });
  }

  // POST /api/clients/revoke（登录：注销某网站的登录 = 撤销本账号在该来源站点的全部会话）
  // 与 /api/sessions/revoke（按设备）互补：这里是按站点批量撤销。
  // WHERE 同时限定 user_id：猜到他站的 apps.id 也删不到别人的会话。
  // 若当前会话本身就来自该站点（例如站点内直接调本接口），它会被一并撤销——这正是「取消该网站登录」应有的语义；
  // 账号中心的调用是同源的（client_id 为 NULL），所以不会把自己踢下线。
  if (method === 'POST' && path === '/api/clients/revoke') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    const body = await request.json().catch(() => ({}));
    const clientId = Number(body.id);
    if (!Number.isInteger(clientId)) return error('参数无效');
    const del = await DB.prepare('DELETE FROM sessions WHERE user_id = ? AND client_id = ?')
      .bind(userId, clientId).run();
    if (del.meta.changes === 0) return error('该网站没有活跃登录', 404);
    return json({ ok: true, revoked: del.meta.changes });
  }

  // GET /api/clients（登录：已授权网站列表 + 每站各自的登录设备，按站点聚合）
  // 只列 client_id 命中 apps 白名单的会话；通行证直连登录（client_id IS NULL）不属于任何站点，
  // 归「登录设备」卡（GET /api/sessions），两卡互不重叠
  // sessions 子数组给前端「展开该站点看设备」用：每条含 rowid（下线标识）/设备名/时间/是否当前设备
  if (method === 'GET' && path === '/api/clients') {
    const userId = await getUserId(DB, request);
    if (!userId) return error('未登录', 401);
    const tokenKey = await getSessionKey(DB, request);
    const rows = await DB.prepare(
      `SELECT s.rowid AS id, s.token, s.user_agent, s.created_at, s.client_id,
              COALESCE(s.last_seen_at, s.created_at) AS last_seen_at,
              a.name, a.origin, a.homepage
       FROM sessions s JOIN apps a ON a.id = s.client_id
       WHERE s.user_id = ?
       ORDER BY last_seen_at DESC`
    ).bind(userId).all();
    // 按站点聚合；行已按 last_seen_at 降序，故首个出现的站点即「最近活跃」，Map 的插入顺序天然就是展示顺序
    const byClient = new Map();
    for (const r of rows.results) {
      if (!byClient.has(r.client_id)) {
        byClient.set(r.client_id, {
          id: r.client_id, name: r.name, origin: r.origin, homepage: r.homepage,
          session_count: 0, last_seen_at: r.last_seen_at, sessions: [],
        });
      }
      const c = byClient.get(r.client_id);
      c.session_count++;
      c.sessions.push({
        id: r.id,
        device: describeDevice(r.user_agent),
        created_at: r.created_at,
        last_seen_at: r.last_seen_at,
        current: r.token === tokenKey,
      });
    }
    return json({ clients: [...byClient.values()] });
  }

  return null; // 不是已知 API 路由
}

// ---------- 安全响应头（只加在 HTML 上） ----------
// CSP 的作用：token 存在 localStorage，一旦页面被注入脚本，脚本就能直接读走 token；
// CSP 收紧「脚本只能来自本站」，把「外部脚本注入 / eval 执行」这条最容易被利用的路堵掉。
// script-src 只放 'self'（**不含** 'unsafe-inline'）：各页的内联 <script> 已抽成 public/*.js 外链、
// 内联 on* 处理器已改为 data-action + 事件委托，故 inline 脚本与内联处理器都会被正确拦下；
// 新增页面/按钮时**不要再写内联脚本或 onclick**，否则会被 CSP 静默拦掉（在控制台才会报错）。
// style-src 仍保留 'unsafe-inline'：页面里有内联 <style> 块，且多处用 style="..." 做数据驱动着色
// （如颜色色板 background），拆成 class 得不偿失。
// img-src 放行 weavatar.com（QQ 头像外链）；frame-ancestors 'none' 禁止本站页面被他人 iframe 嵌套。
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://weavatar.com",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function addSecurityHeaders(res) {
  const type = res.headers.get('Content-Type') || '';
  if (!type.includes('text/html')) return res; // 只给 HTML 加，静态资源与 API JSON 不动
  const h = new Headers(res.headers);
  h.set('Content-Security-Policy', CSP);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

// ---------- 入口 ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS 预检（OPTIONS）：全面放行，任意 Origin 直接回显放行头
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin');
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Vary': 'Origin',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // API 路由
    if (url.pathname.startsWith('/api/')) {
      const result = await handleApi(request, env);
      return corsHeaders(request, result || json({ error: '接口不存在' }, 404));
    }

    // 其余：静态资源（public/），并同步 CORS 头
    const res = await env.ASSETS.fetch(request);
    return corsHeaders(request, addSecurityHeaders(res));
  },
};