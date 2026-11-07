// 生成 ES256（P-256）私钥 JWK，用于 Worker Secret OIDC_PRIVATE_KEY_JWK
//
//   node scripts/gen-oidc-key.mjs
//
// 输出是一行 JSON，整串粘给：
//   npx wrangler secret put OIDC_PRIVATE_KEY_JWK
//
// 私钥只存 Cloudflare Secret，不写进仓库、不写进 .dev.vars 的提交版本。

const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
jwk.alg = 'ES256';
jwk.use = 'sig';
jwk.kid = 'k1';

console.log(JSON.stringify(jwk));
