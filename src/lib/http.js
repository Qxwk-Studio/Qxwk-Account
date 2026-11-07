// Qxwk-Account 通行证 · HTTP 基础工具
// JSON / 错误 / 重定向 / Cookie / base64url / 恒定时间比较
// 这些函数不碰数据库，任何模块都可以引用

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function error(message, status = 400, code = null, params = null) {
  const body = { error: message };
  if (code) body.code = code;
  if (params) body.params = params;
  return json(body, status);
}

export function text(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...headers },
  });
}

export function redirect(location, status = 302) {
  return new Response(null, {
    status,
    headers: { Location: location, 'Cache-Control': 'no-store' },
  });
}

// 只允许站内相对路径跳转：拒绝 //evil.com、http://… 这类绝对地址
export function safeReturnTo(raw) {
  const s = String(raw || '');
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) return '/';
  return s;
}

export function parseCookies(request) {
  const out = {};
  const raw = request.headers.get('Cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[k] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export function getCookie(request, name) {
  return parseCookies(request)[name] || '';
}

export function cookie(name, value, { maxAge = 0, path = '/', secure = true, httpOnly = true, sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  parts.push(`Max-Age=${maxAge}`);
  return parts.join('; ');
}

export function base64url(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(str) {
  const s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64urlDecodeText(str) {
  return new TextDecoder().decode(fromBase64url(str));
}

// 恒定时间比较：长度不同直接 false（长度本身不算秘密）
export function timingSafeEqual(a, b) {
  const x = a instanceof Uint8Array ? a : new TextEncoder().encode(String(a));
  const y = b instanceof Uint8Array ? b : new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// HTML 转义：授权确认页会渲染客户端名与 scope
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function isSecureRequest(request) {
  return new URL(request.url).protocol === 'https:';
}
