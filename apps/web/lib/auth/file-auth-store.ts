/**
 * @file  apps/web/lib/auth/file-auth-store.ts
 * @area  Auth
 * @what  Auth store on a local JSON file (development only).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AuthStore, UserRow, OtpRow } from './types';

/** Local-dev auth store (JSON file). Mirrors PgAuthStore semantics. */
const FILE = path.join(process.cwd(), '.data', 'dev-auth.json');
interface DB { users: UserRow[]; otps: (OtpRow & { email: string; ip: string | null; createdAt: string })[]; audit: unknown[] }
const load = (): DB => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return { users: [], otps: [], audit: [] }; } };
const save = (db: DB) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE); };

export class FileAuthStore implements AuthStore {
  async upsertUserByEmail(email: string, country: string | null) {
    const db = load();
    let u = db.users.find((x) => x.email === email);
    if (!u) { u = { id: crypto.randomUUID(), email, name: null, country, googleSub: null, status: 'active' }; db.users.push(u); save(db); }
    return u;
  }
  async upsertUserByGoogle(p: { sub: string; email: string; name: string | null; country: string | null }) {
    const db = load();
    let u = db.users.find((x) => x.email === p.email);
    if (!u) { u = { id: crypto.randomUUID(), email: p.email, name: p.name, country: p.country, googleSub: p.sub, status: 'active' }; db.users.push(u); }
    else { u.googleSub = u.googleSub || p.sub; u.name = u.name || p.name; }
    save(db);
    return u;
  }
  async markLogin(userId: string, method: 'email' | 'google') { await this.audit(userId, 'login', { method }); }
  async countRecentOtps(p: { email?: string; ip?: string; sinceMinutes: number }) {
    const since = Date.now() - p.sinceMinutes * 60000;
    return load().otps.filter((o) => new Date(o.createdAt).getTime() > since && (p.email ? o.email === p.email : o.ip === p.ip)).length;
  }
  async createOtp(p: { userId: string; email: string; codeHash: string; purpose: 'login'; ttlMinutes: number; ip: string | null }) {
    const db = load();
    db.otps.push({ id: crypto.randomUUID(), userId: p.userId, email: p.email, codeHash: p.codeHash, attempts: 0, ip: p.ip,
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + p.ttlMinutes * 60000).toISOString(), consumedAt: null });
    save(db);
  }
  async latestOtp(email: string) {
    const o = load().otps.filter((x) => x.email === email).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    return o ? { id: o.id, userId: o.userId, codeHash: o.codeHash, attempts: o.attempts, expiresAt: o.expiresAt, consumedAt: o.consumedAt } : null;
  }
  async bumpOtpAttempts(id: string) { const db = load(); const o = db.otps.find((x) => x.id === id); if (!o) return 99; o.attempts++; save(db); return o.attempts; }
  async consumeOtp(id: string) { const db = load(); const o = db.otps.find((x) => x.id === id && !x.consumedAt); if (!o) return false; o.consumedAt = new Date().toISOString(); save(db); return true; }
  async audit(userId: string | null, action: string, meta?: Record<string, unknown>) { const db = load(); db.audit.push({ userId, action, meta, at: new Date().toISOString() }); save(db); }
}
