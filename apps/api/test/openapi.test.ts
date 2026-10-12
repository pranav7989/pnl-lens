/**
 * @file  apps/api/test/openapi.test.ts
 * @area  Tests
 * @what  apps/api/openapi.json matches the routes (regenerate: npm run openapi -w @pnl-lens/api); global and sign-in rate limits.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { openApiDocument, offlineApp } from './openapi-doc.js';
import { ORIGIN } from './helpers.js';

const FILE = path.resolve(__dirname, '../openapi.json');

describe('OpenAPI', () => {
  it('documents every /api/v1 route and is committed up to date', async () => {
    const doc: any = JSON.parse(JSON.stringify(await openApiDocument()));
    const paths = Object.keys(doc.paths);
    for (const p of ['/api/v1/health', '/api/v1/ready', '/api/v1/auth/otp/request', '/api/v1/auth/otp/verify', '/api/v1/auth/google/start',
      '/api/v1/auth/logout', '/api/v1/auth/providers', '/api/v1/me', '/api/v1/plans', '/api/v1/me/consents', '/api/v1/me/export', '/api/v1/me/exports', '/api/v1/me/export/{id}', '/api/v1/me/delete',
      '/api/v1/analyses', '/api/v1/uploads', '/api/v1/analyses/{id}', '/api/v1/reports', '/api/v1/reports/{id}', '/api/v1/reports/{id}/files', '/api/v1/reports/{id}/files/remove',
      '/api/v1/reports/{id}/status', '/api/v1/payments/config', '/api/v1/payments/order', '/api/v1/payments/verify', '/api/v1/payments/webhook',
      '/api/v1/admin/metrics', '/api/v1/admin/roles', '/api/v1/admin/tickets', '/api/v1/admin/user', '/api/v1/admin/grants', '/api/v1/events', '/api/v1/errors']) {
      expect(paths, p).toContain(p);
    }
    expect(paths.some((p) => p.startsWith('/api/payments') || p.startsWith('/api/auth'))).toBe(false);   // legacy aliases are hidden
    if (process.env.UPDATE_OPENAPI === '1') fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n');
    expect(fs.existsSync(FILE), 'run: npm run openapi -w @pnl-lens/api').toBe(true);
    expect(JSON.parse(fs.readFileSync(FILE, 'utf8')), 'openapi.json is stale: npm run openapi -w @pnl-lens/api').toEqual(doc);
  });
});

describe('rate limits (no database needed)', () => {
  it('sign-in routes allow 20 requests a minute per IP, then 429 with the API error shape', async () => {
    const app = await offlineApp();
    try {
      const hit = () => app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { email: 'bad' }, headers: { origin: ORIGIN }, remoteAddress: '203.0.113.9' });
      for (let i = 0; i < 20; i++) expect((await hit()).statusCode).toBe(400);
      const r = await hit();
      expect(r.statusCode).toBe(429);
      expect(r.json()).toMatchObject({ error: 'rate_limited' });
    } finally { await app.close(); }
  });

  it('load-test exemption: only the listed IPs skip the limits', async () => {
    const app = await offlineApp({ rateLimitExemptIps: ['198.51.100.0/24'] });
    try {
      const hit = (ip: string) => app.inject({ method: 'POST', url: '/api/v1/auth/otp/request', payload: { email: 'bad' }, headers: { origin: ORIGIN }, remoteAddress: ip });
      for (let i = 0; i < 25; i++) expect((await hit('198.51.100.7')).statusCode).toBe(400);
      for (let i = 0; i < 20; i++) await hit('203.0.113.10');
      expect((await hit('203.0.113.10')).statusCode).toBe(429);
    } finally { await app.close(); }
  });
});
