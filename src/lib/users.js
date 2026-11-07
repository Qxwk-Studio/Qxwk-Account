// Qxwk-Account 通行证 · 用户与资料
//
// 昵称/颜色是本站保留的产品字段；OIDC 的 sub 直接取 users.id（UUID）。
// 头像仍只对已绑定的 @qq.com 邮箱生成 Cravatar 链接。

import { createHash } from 'node:crypto';

// 60 种 Material 调色板，注册时按用户数顺序取色，池子满了循环
export const USER_COLORS = [
  '#dc2626', '#ef4444', '#f87171', '#ea580c', '#f97316', '#b45309', '#fb923c', '#fdba74', '#d97706', '#f59e0b',
  '#fbbf24', '#eab308', '#fcd34d', '#facc15', '#fde047', '#d9f99d', '#a3e635', '#84cc16', '#65a30d', '#86efac',
  '#4ade80', '#22c55e', '#16a34a', '#6ee7b7', '#34d399', '#10b981', '#99f6e4', '#2dd4bf', '#14b8a6', '#a5f3fc',
  '#22d3ee', '#06b6d4', '#0891b2', '#38bdf8', '#0ea5e9', '#bae6fd', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb',
  '#818cf8', '#6366f1', '#4f46e5', '#a78bfa', '#8b5cf6', '#7c3aed', '#d8b4fe', '#c084fc', '#a855f7', '#f0abfc',
  '#e879f9', '#d946ef', '#f9a8d4', '#f472b6', '#ec4899', '#db2777', '#be185d', '#f43f5e', '#fb7185', '#fda4af',
];

// 只拦最烂的一批，不追求完整字典；长度门槛本身是主要防线
const WEAK_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123',
  'qwertyui', 'qwerty123', 'aaaaaaaa', '11111111', 'admin123', 'letmein1',
  'iloveyou', 'abc12345', '1qaz2wsx', 'zxcvbnm1',
]);

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

export function isValidNickname(nickname) {
  const s = String(nickname || '').trim();
  return s.length >= 1 && s.length <= 20;
}

// 新密码策略：8-128 位、不在弱密码表里
export function isValidPassword(password) {
  const s = String(password || '');
  return s.length >= 8 && s.length <= 128 && !WEAK_PASSWORDS.has(s.toLowerCase());
}

export function passwordRuleText() {
  return '密码需为 8-128 个字符，且不能是常见弱密码';
}

// 头像 URL 集中在这里算：只有 @qq.com 邮箱生成 Cravatar 链接，MD5 取小写去空格后的邮箱
export function getAvatarUrl(email) {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.endsWith('@qq.com')) return null;
  const hash = createHash('md5').update(normalized).digest('hex');
  return `https://cravatar.com/avatar/${hash}?s=400&d=404`;
}

export async function assignColor(DB) {
  const row = await DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  return USER_COLORS[(row ? row.n : 0) % USER_COLORS.length];
}

// 登录标识：昵称优先（大小写敏感），未命中再按邮箱（忽略大小写）
export async function findUserByAccount(DB, account) {
  const value = String(account || '').trim();
  if (!value) return null;
  return (await DB.prepare('SELECT * FROM users WHERE nickname = ?').bind(value).first())
    || (await DB.prepare('SELECT * FROM users WHERE email = ?').bind(normalizeEmail(value)).first());
}

export async function getUserById(DB, id) {
  return DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export function publicProfile(user) {
  return {
    sub: user.id,
    userId: user.id, // 兼容旧字段名，前端同一份渲染逻辑
    nickname: user.nickname,
    color: user.color,
    email: user.email,
    email_verified: !!user.email_verified,
    avatar: getAvatarUrl(user.email),
    created_at: user.created_at,
  };
}

export async function getMe(DB, userId) {
  const user = await getUserById(DB, userId);
  if (!user) return null;
  const p = (await DB.prepare('SELECT * FROM user_profiles WHERE user_id = ?').bind(userId).first()) || {};
  return {
    sub: user.id,
    userId: user.id,
    nickname: user.nickname,
    color: user.color,
    email: user.email,
    email_verified: !!user.email_verified,
    avatar: getAvatarUrl(user.email),
    name: user.nickname,
    picture: getAvatarUrl(user.email),
    locale: p.locale ?? null,
    zoneinfo: p.zoneinfo ?? null,
    website: p.website ?? null,
    phone_number: p.phone_number ?? null,
    phone_number_verified: !!p.phone_number_verified,
    status: user.status,
    created_at: user.created_at,
    updated_at: p.updated_at ?? user.updated_at,
    last_login_at: user.last_login_at,
  };
}
