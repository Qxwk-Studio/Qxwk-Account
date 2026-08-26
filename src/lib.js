// Qxwk-Account 通行证 · 认证与工具（Worker 版）
// 密码哈希使用 Web Crypto PBKDF2，零外部依赖
// 复用自 Qxwk-CityFootprint/src/lib.js，createSession 追加过期会话清理

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

// 创建会话：单会话/用户（重新登录轮换旧 token），并清理 90 天前的过期会话
export async function createSession(DB, userId) {
  const token = generateToken();
  // 登录/注册时清理该用户旧会话，只保留最新一条（旧 token 立即失效）
  await DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  // 顺带清理 90 天前未使用的历史会话，防止 sessions 表无限膨胀
  await DB.prepare("DELETE FROM sessions WHERE created_at < datetime('now', '-90 days')").run();
  await DB.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)')
    .bind(token, userId).run();
  return token;
}

// 从 Authorization: Bearer <token> 解析用户 id
export async function getUserId(DB, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const row = await DB.prepare('SELECT user_id FROM sessions WHERE token = ?').bind(token).first();
  return row ? row.user_id : null;
}

// 注册时分配颜色：按注册顺序（用户数）取色，超过 30 色循环
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