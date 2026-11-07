// Qxwk-Account 通行证 · 密码与随机数
//
// 密码哈希格式（新）：pbkdf2$sha256$<iters>$<salt_b64>$<hash_b64>
// 历史格式（旧库存量）：saltHex:hashHex —— salt 是十六进制**字符串**按 UTF-8 当字节用。
// 迁移不重写哈希（SQL 里做不了 base64），verifyPassword 两种都认；登录成功后就地升级成新格式。

import { timingSafeEqual } from './http.js';

export const PBKDF2_ITERS = 100000;
const KEY_LEN_BITS = 256;

export async function sha256Hex(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(input)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(n) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function uuid() {
  return crypto.randomUUID();
}

// 无偏的 [0, max) 随机整数：拒绝采样，避免 % 带来的模偏差
export function randomInt(max) {
  const limit = Math.floor(0x100000000 / max) * max;
  const arr = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(arr);
    if (arr[0] < limit) return arr[0] % max;
  }
}

function bytesToBase64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(plain, saltBytes, iters) {
  const km = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(plain), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: iters, hash: 'SHA-256' },
    km, KEY_LEN_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(plain) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  // 与旧实现保持一致：salt 以十六进制字符串的形态当字节参与派生（新格式也这么做，
  // 这样同一套验证逻辑只需区分编码方式，不必区分 salt 语义）
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, '0')).join('');
  const hash = await derive(plain, new TextEncoder().encode(saltHex), PBKDF2_ITERS);
  return `pbkdf2$sha256$${PBKDF2_ITERS}$${bytesToBase64(new TextEncoder().encode(saltHex))}$${bytesToBase64(hash)}`;
}

function parseStored(stored) {
  const s = String(stored || '');
  if (s.startsWith('pbkdf2$')) {
    const parts = s.split('$');
    if (parts.length !== 5 || parts[1] !== 'sha256') return null;
    const iters = Number(parts[2]);
    if (!Number.isInteger(iters) || iters <= 0) return null;
    try {
      return {
        kind: 'new',
        iters,
        salt: base64ToBytes(parts[3]),
        hash: base64ToBytes(parts[4]),
      };
    } catch {
      return null;
    }
  }
  const [salt, hash] = s.split(':');
  if (!salt || !hash || !/^[0-9a-f]+$/i.test(hash)) return null;
  return {
    kind: 'legacy',
    iters: PBKDF2_ITERS,
    salt: new TextEncoder().encode(salt),
    hash: hexToBytes(hash.toLowerCase()),
  };
}

// 返回 { ok, needsRehash }；空哈希/禁用哈希（disabled$…）解析失败 → false
export async function verifyPassword(plain, stored) {
  const parsed = parseStored(stored);
  if (!parsed) return { ok: false, needsRehash: false };
  const candidate = await derive(String(plain), parsed.salt, parsed.iters);
  const ok = timingSafeEqual(candidate, parsed.hash);
  return { ok, needsRehash: ok && parsed.kind === 'legacy' };
}
