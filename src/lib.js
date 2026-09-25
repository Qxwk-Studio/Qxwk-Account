// Qxwk-Account 通行证 · 认证与工具（Worker 版）
// 密码哈希使用 Web Crypto PBKDF2，零外部依赖
// 复用自 Qxwk-CityFootprint/src/lib.js；会话为多会话模型（同账号多设备并存，可逐个下线）

// 60 种 Material 调色板，保证新用户颜色不重复（直到池子占满）
export const USER_COLORS = [
  '#dc2626', '#ef4444', '#f87171', '#ea580c', '#f97316', '#b45309', '#fb923c', '#fdba74', '#d97706', '#f59e0b',
  '#fbbf24', '#eab308', '#fcd34d', '#facc15', '#fde047', '#d9f99d', '#a3e635', '#84cc16', '#65a30d', '#86efac',
  '#4ade80', '#22c55e', '#16a34a', '#6ee7b7', '#34d399', '#10b981', '#99f6e4', '#2dd4bf', '#14b8a6', '#a5f3fc',
  '#22d3ee', '#06b6d4', '#0891b2', '#38bdf8', '#0ea5e9', '#bae6fd', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb',
  '#818cf8', '#6366f1', '#4f46e5', '#a78bfa', '#8b5cf6', '#7c3aed', '#d8b4fe', '#c084fc', '#a855f7', '#f0abfc',
  '#e879f9', '#d946ef', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#f43f5e', '#fb7185', '#fda4af',
];

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function error(message, status = 400) {
  return json({ error: message }, status);
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randomBytes(n) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
}

// PBKDF2 密码哈希，返回 "salt:hash"
export async function hashPassword(password) {
  const salt = toHex(randomBytes(16));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return salt + ':' + toHex(bits);
}

export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  return toHex(bits) === hash;
}

function generateToken() {
  return toHex(randomBytes(32));
}

// token 落库前先做 SHA-256：库里只存哈希，D1 被 dump 也无法直接拿去冒用身份
// 查询侧同样先哈希再按主键等值查，性能与原明文存储一致（仍是主键索引命中）；
// 代价是不能再从库里肉眼读 token 调试，排查会话问题请用 rowid / user_id
// 仅模块内部使用（createSession 写入 / resolveSession 查找），不对外导出
async function hashToken(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(token || '')));
  return toHex(buf);
}

// 当前请求所用会话的「键」（即库中 token 列的值；未携带/无效 token 返回空串）。
// 需要与自己会话做比对（标记 current）或排除（下线其他设备）时用它：
// 不能只算一次 sha256——老明文会话要先经 resolveSession 迁移，迁移后的键才与库中一致
export async function getSessionKey(DB, request) {
  const token = getToken(request);
  if (!token) return '';
  const s = await resolveSession(DB, token);
  return s ? s.key : '';
}

// 用原始 token 查会话行，返回 { key, userId, clientId, lastSeenAt }，未命中返回 null。
// key 是「库中 token 列当前的值」，也是后续按行操作（更新活跃时间 / 删除）该用的键。
//
// 这里带一段**一次性兼容逻辑**：改为哈希存储之前签发的会话，token 列里躺的是明文，
// 而新代码一律按 sha256 查，直接查哈希会让所有老会话（含用户自己当前这台设备）查不到、
// 表现为「突然要重新登录」。所以哈希查询未命中时再按明文原值回查一次，命中即把该行就地
// 迁移成哈希（UPDATE），此后就走正常主键命中路径。
//
// 为什么只对 64 位十六进制的输入做回查：老 token 由 generateToken（32 随机字节的 hex）产出，
// 必然是这个形状；哈希也同形，所以这个条件不会漏掉老 token。等老行都迁移完，
// 回查自然不再命中（多一次等值查询的代价只落在「确实不存在」的无效 token 上），无需专门安排下线时间。
export async function resolveSession(DB, rawToken) {
  const token = String(rawToken || '');
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await DB.prepare('SELECT token, user_id, client_id, last_seen_at FROM sessions WHERE token = ?')
    .bind(tokenHash).first();
  if (row) return { key: tokenHash, userId: row.user_id, clientId: row.client_id, lastSeenAt: row.last_seen_at };
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const legacy = await DB.prepare('SELECT user_id, client_id, last_seen_at FROM sessions WHERE token = ?')
    .bind(token).first();
  if (!legacy) return null;
  await DB.prepare('UPDATE sessions SET token = ? WHERE token = ?').bind(tokenHash, token).run();
  return { key: tokenHash, userId: legacy.user_id, clientId: legacy.client_id, lastSeenAt: legacy.last_seen_at };
}

// 创建会话：多会话模型——同一账号可在多台设备同时登录，各自持有独立 token
// userAgent 存原始串（设备名由 describeDevice 在后端集中解析）；last_seen_at 初值取创建时间
// clientId = 登录来源站点（apps.id），clientLabel = 未登记来源的原始串（见 resolveClient）。
// 二者互斥：命中白名单就只记 clientId，未命中就只记 clientLabel；都为空 = 通行证直连登录。
// 账号中心「登录设备」卡只收「两者都为空」的会话，其余一律归「已授权网站」卡（两张卡合起来覆盖全部会话）
// 注意：这里不再删除该用户的历史会话（多会话是有意设计）；「重置密码后踢掉所有设备」场景请显式调用 revokeAllSessions
export async function createSession(DB, userId, userAgent, clientId = null, clientLabel = null) {
  const token = generateToken();
  await DB.prepare(
    "INSERT INTO sessions (token, user_id, user_agent, client_id, client_label, last_seen_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).bind(
    await hashToken(token), userId, String(userAgent || '').trim() || null,
    clientId || null,
    // 归一化放这里：白名单站点不再重复记标签，避免同一个会话出现两种来源表示
    clientId ? null : (clientLabel || null)
  ).run();
  // 顺带回收「长期没人用」的会话：90 天未活跃（无 last_seen_at 的老行按创建时间算）即删除。
  // 这不与「会话不自动过期」冲突——被删的都是九十天没露过面的记录，不会因此把活跃设备踢下线；
  // 目的是避免 sessions 表只增不减（大量被遗弃的会话会永久滞留）
  await DB.prepare(
    "DELETE FROM sessions WHERE COALESCE(last_seen_at, created_at) < datetime('now', '-90 days')"
  ).run();
  return token;
}

// 判定本次登录来源站点，返回 { id, label }
//   id    = 命中 apps 白名单时的 apps.id，否则 null
//   label = 未命中白名单时的「原始来源串」（调用方声明的 client 值，或请求的 Origin 头），否则 null
// 取值优先级：显式 client 参数 → 请求 Origin 头。显式参数是必须的：
// 安卓 App / 服务端直连调用没有 Origin 头，只能由调用方自己声明；能声明不等于可信，
// 因此 id（用于按站点聚合、批量注销）**必须**命中白名单才给；未命中的只作为 label 标注出来，
// 界面上标成「未登记来源」——宁可不认这个站点名，也不把自报的名字当权威。
// 两者都为 null = 通行证直连登录，归账号中心「登录设备」卡
export async function resolveClient(DB, request, explicit) {
  const raw = String(explicit || '').trim() || (request.headers.get('Origin') || '').trim();
  // Origin: null 是沙箱 iframe / file:// 等不透明来源按规范发的值；调用方也可能自报 "null"/"undefined"。
  // 这些都不是真来源，当「没有来源」处理——否则「已授权网站」卡里会冒出一个叫 "null" 的来源，既看不懂、也没法跟人对上
  if (!raw || /^(null|undefined)$/i.test(raw)) return { id: null, label: null };
  // 能解析成 URL 就按 origin 精确匹配（new URL 会规范化大小写与默认端口、去掉路径）；
  // 否则当作站点名匹配——App 端传的是应用名，没有 origin
  let origin = '';
  try { origin = new URL(raw).origin; } catch (e) { origin = ''; }
  // 通行证自己的页面（同源）不算第三方来源，否则 account.html 的登录会被误标成某个站点
  if (origin && origin === new URL(request.url).origin) return { id: null, label: null };
  const row = origin
    ? await DB.prepare('SELECT id FROM apps WHERE origin = ?').bind(origin).first()
    : await DB.prepare('SELECT id FROM apps WHERE name = ?').bind(raw).first();
  if (row) return { id: row.id, label: null };
  // 未登记：截断到 100 字符再入库，避免调用方塞超长串把界面和库撑坏
  return { id: null, label: (origin || raw).slice(0, 100) };
}

// 撤销该用户的全部会话（重置密码等安全场景：让所有设备一并登出）
export async function revokeAllSessions(DB, userId) {
  await DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

// 取出 Authorization: Bearer <token> 中的 token（未携带则返回空串）
export function getToken(request) {
  const auth = request.headers.get('Authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

// UA 原始串 → 「系统 · 浏览器」展示名（后端集中一份，前端只消费此字符串）
// 判定顺序敏感：Edge/Opera 的 UA 里同样含 "Chrome"、Chrome 的 UA 里含 "Safari"，所以必须先判更具体的
export function describeDevice(ua) {
  const s = String(ua || '');
  if (!s) return '未知设备';
  let os = '';
  if (/Windows NT/.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/Mac OS X/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';
  let browser = '';
  if (/Edg[A-Za-z]*\//.test(s)) browser = 'Edge';
  else if (/OPR\//.test(s)) browser = 'Opera';
  // iOS 上的浏览器都是 WebKit 内核，UA 里不含 Chrome/Firefox，而是各自的前缀（含 Safari/ 兜底标识），必须单独判
  else if (/EdgiOS\//.test(s)) browser = 'Edge';
  else if (/CriOS\//.test(s)) browser = 'Chrome';
  else if (/FxiOS\//.test(s)) browser = 'Firefox';
  else if (/Firefox\//.test(s)) browser = 'Firefox';
  else if (/Chrome\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s)) browser = 'Safari';
  if (!os && !browser) return '未知设备';
  return os && browser ? os + ' · ' + browser : (os || browser);
}

// 从 Authorization: Bearer <token> 解析用户 id，并节流滚动更新 last_seen_at
// 节流原因：每个鉴权请求都写库会让 D1 产生大量无意义写入，故与上次记录相差超过 1 小时才更新一次
export async function getUserId(DB, request) {
  const token = getToken(request);
  if (!token) return null;
  const s = await resolveSession(DB, token); // 含「老明文会话就地迁移为哈希」的兼容逻辑，见 resolveSession
  if (!s) return null;
  // 库中为 UTC 的 'YYYY-MM-DD HH:MM:SS'，需按 UTC 解析；解析失败（历史 NULL）当作 0 → 立即补写一次
  const last = Date.parse(String(s.lastSeenAt || '').replace(' ', 'T') + 'Z') || 0;
  if (Date.now() - last > 3600 * 1000) {
    // 用 s.key（迁移后即哈希）而非重新计算的哈希：老行刚被 UPDATE 过，此刻库里就是 s.key
    await DB.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE token = ?").bind(s.key).run();
  }
  return s.userId;
}

// ---------- 登录失败限流（防止无限撞密码） ----------
// 策略：按「账号」计数（昵称/邮箱统一转小写作为键），15 分钟窗口内失败满 5 次即锁定 15 分钟，登录成功立即清空。
// 为什么不按 IP：D1 场景下拿不到稳定可信的客户端 IP，而按账号限流正好挡住「针对某个账号的暴力破解」这个主要威胁；
// 记账与账号是否存在无关（不存在的账号一样计数），否则 429 的有无就成了「该账号是否存在」的探针，防枚举失效。
// 代价：攻击者可以故意失败 5 次把某个账号临时锁住（15 分钟后自动解锁），这是换取「无法无限撞密码」的已知取舍。
const LOGIN_FAIL_LIMIT = 5;            // 窗口内允许的失败次数
const LOGIN_FAIL_WINDOW = '-15 minutes'; // 计数窗口
const LOGIN_LOCK_FOR = '+15 minutes';    // 达到上限后的锁定时长

// 返回剩余锁定秒数（0 = 未锁定；locked_until 为 NULL 或已过期都返回 0）
export async function loginLockRemaining(DB, accountKey) {
  const row = await DB.prepare(
    "SELECT CAST(strftime('%s', locked_until) - strftime('%s', 'now') AS INTEGER) AS sec FROM login_attempts WHERE account = ?"
  ).bind(accountKey).first();
  return row && row.sec > 0 ? row.sec : 0;
}

// 记一次失败：窗口内累加，窗口外重新计数；达到上限则清零计数并写入锁定截止时间
// 注意 datetime('now', ?) 的修饰符用占位符传入，不拼字符串
export async function recordLoginFail(DB, accountKey) {
  await DB.prepare(
    `INSERT INTO login_attempts (account, fail_count, first_fail_at, locked_until)
     VALUES (?, 1, datetime('now'), NULL)
     ON CONFLICT(account) DO UPDATE SET
       fail_count = CASE WHEN login_attempts.first_fail_at < datetime('now', ?)
                         THEN 1 ELSE login_attempts.fail_count + 1 END,
       first_fail_at = CASE WHEN login_attempts.first_fail_at < datetime('now', ?)
                            THEN datetime('now') ELSE login_attempts.first_fail_at END`
  ).bind(accountKey, LOGIN_FAIL_WINDOW, LOGIN_FAIL_WINDOW).run();
  await DB.prepare(
    `UPDATE login_attempts SET fail_count = 0, locked_until = datetime('now', ?)
     WHERE account = ? AND fail_count >= ?`
  ).bind(LOGIN_LOCK_FOR, accountKey, LOGIN_FAIL_LIMIT).run();
}

// 登录成功：清掉该账号的失败记录（不必等窗口自然过期）
export async function clearLoginFails(DB, accountKey) {
  await DB.prepare('DELETE FROM login_attempts WHERE account = ?').bind(accountKey).run();
}

// 注册时分配颜色：按注册顺序（用户数）取色，超过 60 色循环
export async function assignColor(DB) {
  const { count } = await DB.prepare('SELECT COUNT(*) as count FROM users').first();
  return USER_COLORS[count % USER_COLORS.length];
}

// 简单校验
export function isValidNickname(n) {
  return typeof n === 'string' && n.trim().length >= 1 && n.trim().length <= 20;
}
export function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 4 && p.length <= 50;
}

// 根据邮箱生成 WeAvatar 头像链接：仅 QQ 邮箱返回链接；其余邮箱或无邮箱返回 null（前端回退文字头像）
// 哈希用 SHA-256（Web Crypto 原生 crypto.subtle.digest，替代原先手写的 150 行 MD5 实现）：
// WeAvatar 文档明确 HASH 可为 SHA256 或 MD5，并推荐 SHA256
// 注意：crypto.subtle.digest 只能异步，故本函数是 async，所有调用方必须 await
export async function getAvatarUrl(email) {
  if (!email) return null;
  if (!/@qq\.com$/i.test(String(email).trim())) return null;
  const data = new TextEncoder().encode(String(email).trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', data);
  return 'https://weavatar.com/avatar/' + toHex(digest) + '?s=400&d=404';
}

// 生成 6 位数字邮箱验证码（crypto 随机，非 Math.random）
export function genEmailCode() {
  const n = new DataView(randomBytes(4).buffer).getUint32(0);
  return String(n % 1000000).padStart(6, '0');
}

// 发送邮件：调用 Resend API。env.EMAIL_API_KEY 需在 wrangler.toml 或 secret 中配置
// from 域名需在 Resend 后台完成 SPF/DKIM 验证后才能作为发件地址
export async function sendEmail(env, to, subject, html) {
  const key = env.EMAIL_API_KEY;
  if (!key) throw new Error('未配置 EMAIL_API_KEY');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Qxwk 通行证 <no-reply@account.qxwkstudio.top>',
      to, subject, html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`邮件发送失败 ${res.status}: ${detail}`);
  }
  return res.json();
}

// 品牌邮件 HTML 模板（验证码 / 重置密码通用）。table + 内联样式，兼容主流邮箱客户端
export function renderBrandEmail({
  eyebrow = 'Qxwk 通行证',
  title = '邮箱验证码',
  intro = '',
  code = '',
  validity = '<b>10 分钟</b> 内有效，过期需重新获取。',
  warn = '若非本人操作，请忽略本邮件并不要告知他人验证码。',
} = {}) {
  return `<div style="background:#f1f5f9;margin:0;padding:32px 16px;font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:420px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:#2563eb;padding:6px 0;"></td>
          </tr>
          <tr>
            <td style="padding:28px 32px 0;text-align:center;">
              <div style="font-size:17px;font-weight:700;color:#0f172a;letter-spacing:.3px;">青翔未阔工作室</div>
              <div style="font-size:12px;color:#64748b;margin-top:2px;">${eyebrow} · ${title}</div>
            </td>
          </tr>
          ${intro ? `<tr>
            <td style="padding:20px 32px 0;font-size:14px;line-height:1.7;color:#334155;">${intro}</td>
          </tr>` : ''}
          <tr>
            <td style="padding:18px 32px 0;">
              <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:18px;text-align:center;">
                <div style="font-size:11px;color:#64748b;letter-spacing:1px;">验证码</div>
                <div style="font-size:32px;font-weight:800;letter-spacing:6px;color:#2563eb;margin-top:4px;">${code}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 0;font-size:12px;color:#64748b;text-align:center;">验证码 ${validity}</td>
          </tr>
          <tr>
            <td style="padding:16px 32px 0;">
              <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;font-size:12px;color:#92400e;line-height:1.6;">${warn}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 24px;font-size:11px;color:#94a3b8;text-align:center;">此邮件由系统自动发送，请勿直接回复。</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}

// 生成密码重置验证码邮件 HTML
export function renderResetEmail(code) {
  return renderBrandEmail({
    eyebrow: 'Qxwk 通行证',
    title: '重置密码',
    intro: '你好，我们收到了你的密码重置申请。请在页面输入下方验证码，并设置你的新密码：',
    code,
  });
}