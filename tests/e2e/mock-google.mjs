/**
 * @file  tests/e2e/mock-google.mjs
 * @area  Tests
 * @what  Mock Google OpenID provider used by the sign-in E2E.
 */
// Minimal OpenID provider standing in for Google in tests. Real RS256 tokens + JWKS.
// Env: PORT (4555), CLIENT_ID, MOCK_EMAIL, MOCK_EMAIL_VERIFIED ("false" to test rejection)
import http from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
const PORT = Number(process.env.PORT || 4555), ISS = `http://localhost:${PORT}`;
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const codes = new Map(); // code -> { nonce, challenge }
let cfg = { email: process.env.MOCK_EMAIL || 'trader@gmail.com', verified: process.env.MOCK_EMAIL_VERIFIED !== 'false' };
http.createServer(async (req, res) => {
  const u = new URL(req.url, ISS);
  if (u.pathname === '/config' && req.method === 'POST') { let b = ''; for await (const c of req) b += c; cfg = { ...cfg, ...JSON.parse(b) }; res.end('ok'); return; }
  if (u.pathname === '/auth') {
    const code = 'c' + Math.random().toString(36).slice(2);
    codes.set(code, { nonce: u.searchParams.get('nonce'), challenge: u.searchParams.get('code_challenge') });
    const back = new URL(u.searchParams.get('redirect_uri'));
    back.searchParams.set('code', code); back.searchParams.set('state', cfg.badState ? 'tampered' : u.searchParams.get('state'));
    res.writeHead(302, { Location: back.toString() }); res.end(); return;
  }
  if (u.pathname === '/token') {
    let b = ''; for await (const c of req) b += c;
    const p = new URLSearchParams(b), entry = codes.get(p.get('code'));
    const { createHash } = await import('node:crypto');
    const ok = entry && createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === entry.challenge;
    if (!ok) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid_grant' })); return; }
    const id_token = await new SignJWT({ email: cfg.email, email_verified: cfg.verified, name: 'Test Trader', nonce: entry.nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISS).setAudience(process.env.CLIENT_ID)
      .setSubject('google-sub-' + cfg.email).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ id_token, access_token: 'x', token_type: 'Bearer' })); return;
  }
  if (u.pathname === '/jwks') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ keys: [jwk] })); return; }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`mock google on ${ISS}`));
