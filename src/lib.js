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

// 创建会话：多会话模型——同一账号可在多台设备同时登录，各自持有独立 token
// userAgent 存原始串（设备名由 describeDevice 在后端集中解析）；last_seen_at 初值取创建时间
// 注意：这里不再删除该用户的历史会话（多会话是有意设计）；「重置密码后踢掉所有设备」场景请显式调用 revokeAllSessions
export async function createSession(DB, userId, userAgent) {
  const token = generateToken();
  await DB.prepare(
    "INSERT INTO sessions (token, user_id, user_agent, last_seen_at) VALUES (?, ?, ?, datetime('now'))"
  ).bind(token, userId, String(userAgent || '').trim() || null).run();
  return token;
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
  const row = await DB.prepare('SELECT user_id, last_seen_at FROM sessions WHERE token = ?').bind(token).first();
  if (!row) return null;
  // 库中为 UTC 的 'YYYY-MM-DD HH:MM:SS'，需按 UTC 解析；解析失败（历史 NULL）当作 0 → 立即补写一次
  const last = Date.parse(String(row.last_seen_at || '').replace(' ', 'T') + 'Z') || 0;
  if (Date.now() - last > 3600 * 1000) {
    await DB.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE token = ?").bind(token).run();
  }
  return row.user_id;
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