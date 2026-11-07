// Qxwk-Account 通行证 · ES256 JWT
//
// 私钥来自 Secret OIDC_PRIVATE_KEY_JWK（JSON 字符串），只用于签名；
// 对外的 JWKS 由同一个 JWK 的 x/y 生成，绝不带 d。
// 密钥导入按 JWK 字符串缓存：同一请求内多次签发/校验不重复 import。

import { base64url, base64urlDecodeText, fromBase64url } from './http.js';

let cache = { raw: '', privateKey: null, publicKey: null, jwk: null };

function parseJwk(env) {
  const raw = env.OIDC_PRIVATE_KEY_JWK;
  if (!raw) throw new Error('未配置 OIDC_PRIVATE_KEY_JWK');
  const jwk = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.d || !jwk.x || !jwk.y) {
    throw new Error('OIDC_PRIVATE_KEY_JWK 不是 P-256 私钥 JWK');
  }
  return jwk;
}

async function getKeys(env) {
  const raw = String(env.OIDC_PRIVATE_KEY_JWK || '');
  if (cache.raw === raw && cache.privateKey) return cache;
  const jwk = parseJwk(env);
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { ...jwk, alg: 'ES256', ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, alg: 'ES256', ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );
  cache = { raw, privateKey, publicKey, jwk };
  return cache;
}

export async function signJwt(payload, env) {
  const { privateKey } = await getKeys(env);
  const header = { alg: 'ES256', typ: 'JWT', kid: 'k1' };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(signingInput),
  );
  // WebCrypto 的 ECDSA 输出就是 JWS 需要的 r||s（64 字节），不需要 DER 转换
  return `${signingInput}.${base64url(new Uint8Array(sig))}`;
}

export async function verifyJwt(token, env) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  let header;
  let payload;
  try {
    header = JSON.parse(base64urlDecodeText(h));
    payload = JSON.parse(base64urlDecodeText(p));
  } catch {
    return null;
  }
  if (!header || header.alg !== 'ES256') return null;
  const { publicKey } = await getKeys(env);
  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      fromBase64url(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
  } catch {
    return null;
  }
  if (!ok) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (payload.iss !== env.ISSUER) return null;
  return payload;
}

export async function getJwks(env) {
  const { jwk } = await getKeys(env);
  return {
    keys: [{ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, kid: 'k1', use: 'sig', alg: 'ES256' }],
  };
}
