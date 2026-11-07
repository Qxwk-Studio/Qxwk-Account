// Qxwk-Account 通行证 · 最简 OIDC（授权码 + PKCE S256）
//
// 支持：discovery / jwks / authorize / token / userinfo。
// 刻意不做：refresh_token、consent（静默同意，仅被用户撤销过的客户端除外）、CORS。
// 授权码 60 秒、只存 SHA-256、consumed 原子消费；id_token/access_token 均为 ES256。

import { base64url, escapeHtml, html, json, redirect, text, timingSafeEqual } from './http.js';
import { sha256Hex, uuid } from './crypto.js';
import { getJwks, signJwt, verifyJwt } from './jwt.js';
import { getSession } from './session.js';
import { getAvatarUrl } from './users.js';

const CODE_TTL_SECONDS = 60;
const TOKEN_TTL_SECONDS = 3600;

function issuerOf(env) {
  const iss = String(env.ISSUER || '').replace(/\/+$/, '');
  if (!iss) throw new Error('未配置 ISSUER');
  return iss;
}

function scopesOf(value) {
  return String(value || '').split(/\s+/).filter(Boolean);
}

function intersect(a, b) {
  const set = new Set(b);
  return a.filter((s) => set.has(s));
}

async function getOAuthClient(DB, clientId) {
  return DB.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').bind(clientId).first();
}

async function findAudienceClient(DB, clientId) {
  const oauth = await DB.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').bind(clientId).first();
  if (oauth) return oauth;
  return DB.prepare('SELECT * FROM api_clients WHERE client_id = ?').bind(clientId).first();
}

function redirectAllowed(client, uri) {
  const list = String(client.redirect_uris || '').split('\n').map((s) => s.trim()).filter(Boolean);
  return list.includes(String(uri || ''));
}

function badRequest(message) {
  return text(message, 400);
}

function tokenError(code = 'invalid_grant') {
  return json({ error: code }, 400);
}

function unauthorizedBearer() {
  return json({ error: 'invalid_token' }, 401, {
    'WWW-Authenticate': 'Bearer error="invalid_token"',
  });
}

// ---------------------------------------------------------------------------
// Discovery / JWKS
// ---------------------------------------------------------------------------
export function handleDiscovery(env) {
  const iss = issuerOf(env);
  return json({
    issuer: iss,
    authorization_endpoint: `${iss}/authorize`,
    token_endpoint: `${iss}/token`,
    userinfo_endpoint: `${iss}/userinfo`,
    jwks_uri: `${iss}/jwks`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['ES256'],
    scopes_supported: ['openid', 'profile', 'email', 'phone'],
    claims_supported: [
      'iss', 'sub', 'aud', 'exp', 'iat', 'auth_time', 'nonce',
      'email', 'email_verified', 'name', 'picture', 'color',
    ],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
  });
}

export async function handleJwks(env) {
  return json(await getJwks(env));
}

// ---------------------------------------------------------------------------
// Authorize
// ---------------------------------------------------------------------------
function authorizeConfirmPage(params, client) {
  const fields = ['response_type', 'client_id', 'redirect_uri', 'scope', 'code_challenge',
    'code_challenge_method', 'state', 'nonce'];
  const hidden = fields
    .filter((k) => params.get(k))
    .map((k) => `<input type="hidden" name="${k}" value="${escapeHtml(params.get(k))}">`)
    .join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>重新授权 · Qxwk 通行证</title>
<style>body{font-family:system-ui,sans-serif;background:#f1f5f9;color:#0f172a;margin:0;padding:40px 16px}
.card{max-width:420px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px}
h1{font-size:18px;margin:0 0 12px}p{font-size:14px;line-height:1.7;color:#334155}
.row{display:flex;gap:10px;margin-top:20px}button{flex:1;padding:10px;border-radius:10px;border:0;font-size:14px;cursor:pointer}
.ok{background:#2563eb;color:#fff}.no{background:#e2e8f0;color:#0f172a}
code{background:#f1f5f9;padding:2px 6px;border-radius:6px}</style></head>
<body><div class="card">
<h1>重新授权「${escapeHtml(client.client_name)}」</h1>
<p>你之前撤销过这个应用。它现在请求访问：<br><code>${escapeHtml(params.get('scope'))}</code></p>
<p>允许后，它会重新出现在「已授权应用」里。</p>
<form method="POST" action="/authorize">${hidden}
<div class="row"><button class="ok" type="submit" name="approve" value="1">允许</button>
<button class="no" type="submit" name="approve" value="0">取消</button></div></form>
</div></body></html>`;
}

export async function handleAuthorize(request, env) {
  const DB = env.DB;
  const url = new URL(request.url);
  const isPost = request.method === 'POST';
  const params = isPost ? new URLSearchParams(await request.text()) : url.searchParams;

  if (params.get('response_type') !== 'code') return badRequest('unsupported_response_type');

  const clientId = params.get('client_id') || '';
  const client = await getOAuthClient(DB, clientId);
  if (!client || client.status !== 'active') return badRequest('invalid_client');

  const redirectUri = params.get('redirect_uri') || '';
  if (!redirectAllowed(client, redirectUri)) return badRequest('invalid_redirect_uri');

  const scope = params.get('scope') || '';
  const requested = scopesOf(scope);
  const allowed = scopesOf(client.allowed_scopes);
  if (!requested.includes('openid') || intersect(requested, allowed).length !== requested.length) {
    return badRequest('invalid_scope');
  }

  const challenge = params.get('code_challenge') || '';
  if (!challenge) return badRequest('code_challenge_required');
  if (params.get('code_challenge_method') !== 'S256') return badRequest('unsupported_code_challenge_method');

  const session = await getSession(DB, request);
  if (!session) {
    const returnTo = `${url.pathname}${url.search}`;
    return redirect(`/login.html?return_to=${encodeURIComponent(returnTo)}`);
  }

  const grant = await DB.prepare(
    'SELECT revoked_at FROM oauth_grants WHERE user_id = ? AND client_id = ?',
  ).bind(session.userId, client.client_id).first();

  // 用户撤销过的客户端：不再静默放行，需要一次显式确认
  if (grant && grant.revoked_at) {
    if (!isPost) return html(authorizeConfirmPage(params, client));
    if (params.get('approve') !== '1') {
      const target = new URL(redirectUri);
      target.searchParams.set('error', 'access_denied');
      if (params.get('state')) target.searchParams.set('state', params.get('state'));
      return redirect(target.toString());
    }
  }

  const code = uuid();
  const codeHash = await sha256Hex(code);
  const nonce = params.get('nonce') || null;
  const authTime = Number(session.authTime) || Math.floor(Date.now() / 1000);

  await DB.prepare(
    `INSERT INTO oauth_authorization_codes
       (code_hash, client_id, user_id, redirect_uri, scope, code_challenge, nonce, auth_time, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+60 seconds'))`,
  ).bind(codeHash, client.client_id, session.userId, redirectUri, scope, challenge, nonce, authTime).run();

  await DB.prepare(
    `INSERT INTO oauth_grants (user_id, client_id, first_authorized_at, last_authorized_at, revoked_at)
     VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL)
     ON CONFLICT(user_id, client_id) DO UPDATE SET
       last_authorized_at = CURRENT_TIMESTAMP,
       revoked_at = NULL`,
  ).bind(session.userId, client.client_id).run();

  const target = new URL(redirectUri);
  target.searchParams.set('code', code);
  if (params.get('state')) target.searchParams.set('state', params.get('state'));
  return redirect(target.toString());
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------
function parseBasic(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Basic ')) return null;
  try {
    const decoded = atob(auth.slice(6).trim());
    const i = decoded.indexOf(':');
    if (i < 0) return null;
    return { clientId: decoded.slice(0, i), secret: decoded.slice(i + 1) };
  } catch {
    return null;
  }
}

async function pkceMatches(verifier, challenge) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(verifier || '')));
  return timingSafeEqual(base64url(new Uint8Array(digest)), String(challenge || ''));
}

export async function handleToken(request, env) {
  const DB = env.DB;
  if (request.method !== 'POST') return tokenError('invalid_request');
  const form = new URLSearchParams(await request.text().catch(() => ''));

  if (form.get('grant_type') !== 'authorization_code') return tokenError('unsupported_grant_type');

  const basic = parseBasic(request);
  const clientId = basic ? basic.clientId : (form.get('client_id') || '');
  const clientSecret = basic ? basic.secret : (form.get('client_secret') || '');
  if (!clientId) return tokenError('invalid_client');

  const client = await getOAuthClient(DB, clientId);
  if (!client || client.status !== 'active') return tokenError('invalid_client');

  if (client.client_type === 'confidential') {
    if (!client.client_secret_hash) return tokenError('invalid_client');
    const hash = await sha256Hex(clientSecret);
    if (!timingSafeEqual(hash, client.client_secret_hash)) return tokenError('invalid_client');
  } else if (client.client_secret_hash) {
    return tokenError('invalid_client');
  }

  const code = form.get('code') || '';
  const redirectUri = form.get('redirect_uri') || '';
  const verifier = form.get('code_verifier') || '';
  if (!code || !redirectUri || !verifier) return tokenError('invalid_request');

  const codeHash = await sha256Hex(code);
  const row = await DB.prepare(
    `SELECT * FROM oauth_authorization_codes
      WHERE code_hash = ? AND consumed = 0 AND expires_at > CURRENT_TIMESTAMP`,
  ).bind(codeHash).first();
  if (!row) return tokenError('invalid_grant');
  if (row.client_id !== client.client_id || row.redirect_uri !== redirectUri) return tokenError('invalid_grant');
  if (!(await pkceMatches(verifier, row.code_challenge))) return tokenError('invalid_grant');

  // 先消费再签发：并发兑换同一授权码时只有 changes === 1 的请求能继续
  const consumed = await DB.prepare(
    'UPDATE oauth_authorization_codes SET consumed = 1 WHERE code_hash = ? AND consumed = 0',
  ).bind(codeHash).run();
  if (consumed.meta.changes !== 1) return tokenError('invalid_grant');

  const user = await DB.prepare(
    'SELECT id, nickname, color, email, email_verified, status FROM users WHERE id = ?',
  ).bind(row.user_id).first();
  if (!user || user.status !== 'active') return tokenError('invalid_grant');

  const iss = issuerOf(env);
  const now = Math.floor(Date.now() / 1000);
  const scopes = scopesOf(row.scope);
  const base = { iss, sub: user.id, aud: client.client_id, iat: now, exp: now + TOKEN_TTL_SECONDS };

  const idClaims = { ...base, auth_time: row.auth_time };
  if (row.nonce) idClaims.nonce = row.nonce;
  if (scopes.includes('email')) {
    idClaims.email = user.email;
    idClaims.email_verified = !!user.email_verified;
  }
  if (scopes.includes('profile')) {
    idClaims.name = user.nickname;
    idClaims.color = user.color;
    const avatar = getAvatarUrl(user.email);
    if (avatar) idClaims.picture = avatar;
  }

  const idToken = await signJwt(idClaims, env);
  const accessToken = await signJwt({
    iss,
    sub: user.id,
    aud: client.client_id,
    scope: row.scope,
    token_use: 'access',
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    jti: uuid(),
  }, env);

  return json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SECONDS,
    id_token: idToken,
    scope: row.scope,
  });
}

// ---------------------------------------------------------------------------
// Userinfo
// ---------------------------------------------------------------------------
export async function handleUserinfo(request, env) {
  const DB = env.DB;
  if (request.method !== 'GET' && request.method !== 'POST') return unauthorizedBearer();
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return unauthorizedBearer();

  const claims = await verifyJwt(auth.slice(7).trim(), env);
  if (!claims || claims.token_use !== 'access') return unauthorizedBearer();

  const client = await findAudienceClient(DB, claims.aud);
  if (!client || client.status !== 'active') return unauthorizedBearer();

  const user = await DB.prepare(
    'SELECT id, nickname, color, email, email_verified, status FROM users WHERE id = ?',
  ).bind(claims.sub).first();
  if (!user || user.status !== 'active') return unauthorizedBearer();

  const scopes = intersect(scopesOf(claims.scope), scopesOf(client.allowed_scopes));
  const out = { sub: user.id };

  if (scopes.includes('email')) {
    out.email = user.email;
    out.email_verified = !!user.email_verified;
  }

  if (scopes.includes('profile') || scopes.includes('phone')) {
    const p = await DB.prepare('SELECT * FROM user_profiles WHERE user_id = ?').bind(user.id).first() || {};
    if (scopes.includes('profile')) {
      out.name = p.name || user.nickname;
      const avatar = p.picture || getAvatarUrl(user.email);
      if (avatar) out.picture = avatar;
      out.color = user.color;
      if (p.locale) out.locale = p.locale;
      if (p.zoneinfo) out.zoneinfo = p.zoneinfo;
      if (p.website) out.website = p.website;
    }
    if (scopes.includes('phone') && p.phone_number) {
      out.phone_number = p.phone_number;
      out.phone_number_verified = !!p.phone_number_verified;
    }
  }

  return json(out);
}

export { CODE_TTL_SECONDS, TOKEN_TTL_SECONDS };
