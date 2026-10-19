/**
 * @file  packages/shared/src/auth/pg-auth-store.ts
 * @area  Auth
 * @what  Auth store on PostgreSQL (users, OTP codes, audit log); the connection is passed in (web pool or API pool).
 */
import type { AuthStore, UserRow, OtpRow } from './types';
import type { Queryable } from '../db';

const toUser = (r: any): UserRow => ({ id: r.id, email: r.email, name: r.name, country: r.country ? String(r.country).trim() : null, googleSub: r.google_sub, status: r.status });
const U = 'id, email, name, country, google_sub, status';

export class PgAuthStore implements AuthStore {
  constructor(private readonly db: Queryable) {}

  async upsertUserByEmail(email: string, country: string | null) {
    const { rows } = await this.db.query(
      `insert into public.users (email, country) values ($1, $2)
       on conflict (email) do update set email = excluded.email
       returning ${U}`, [email, country]);
    return toUser(rows[0]);
  }

  async upsertUserByGoogle(p: { sub: string; email: string; name: string | null; country: string | null }) {
    // Link by Google subject first, then by verified email (same person signing in both ways).
    const { rows } = await this.db.query(
      `insert into public.users (email, google_sub, name, country, email_verified_at) values ($1, $2, $3, $4, now())
       on conflict (email) do update
         set google_sub = coalesce(public.users.google_sub, excluded.google_sub),
             name = coalesce(public.users.name, excluded.name),
             email_verified_at = coalesce(public.users.email_verified_at, now())
       returning ${U}`, [p.email, p.sub, p.name, p.country]);
    return toUser(rows[0]);
  }

  async markLogin(userId: string, method: 'email' | 'google' | 'password') {
    await this.db.query(
      `update public.users set last_login_at = now(), email_verified_at = coalesce(email_verified_at, now()) where id = $1`, [userId]);
    await this.audit(userId, 'login', { method });
  }

  async countRecentOtps(p: { email?: string; ip?: string; sinceMinutes: number }) {
    if (p.email) {
      const { rows } = await this.db.query(`select count(*)::int n from public.otp_codes where destination = $1 and created_at > now() - make_interval(mins => $2)`, [p.email, p.sinceMinutes]);
      return rows[0].n;
    }
    const { rows } = await this.db.query(`select count(*)::int n from public.otp_codes where ip = $1::inet and created_at > now() - make_interval(mins => $2)`, [p.ip, p.sinceMinutes]);
    return rows[0].n;
  }

  async createOtp(p: { userId: string; email: string; codeHash: string; purpose: 'login'; ttlMinutes: number; ip: string | null }) {
    await this.db.query(
      `insert into public.otp_codes (user_id, channel, destination, code_hash, purpose, expires_at, ip)
       values ($1, 'email', $2, $3, 'login', now() + make_interval(mins => $4), $5::inet)`,
      [p.userId, p.email, p.codeHash, p.ttlMinutes, p.ip]);
  }

  async latestOtp(email: string): Promise<OtpRow | null> {
    const { rows } = await this.db.query(
      `select id, user_id, code_hash, attempts, expires_at, consumed_at from public.otp_codes
       where destination = $1 order by created_at desc limit 1`, [email]);
    const r = rows[0];
    return r ? { id: r.id, userId: r.user_id, codeHash: r.code_hash, attempts: r.attempts, expiresAt: new Date(r.expires_at).toISOString(), consumedAt: r.consumed_at ? new Date(r.consumed_at).toISOString() : null } : null;
  }

  async bumpOtpAttempts(id: string) {
    const { rows } = await this.db.query(`update public.otp_codes set attempts = attempts + 1 where id = $1 returning attempts`, [id]);
    return rows[0]?.attempts ?? 99;
  }

  async consumeOtp(id: string) {
    const { rowCount } = await this.db.query(`update public.otp_codes set consumed_at = now() where id = $1 and consumed_at is null`, [id]);
    return rowCount === 1;
  }

  async audit(userId: string | null, action: string, meta?: Record<string, unknown>, ip?: string | null) {
    await this.db.query(`insert into public.audit_log (user_id, action, meta, ip) values ($1, $2, $3, $4::inet)`, [userId, action, meta ? JSON.stringify(meta) : null, ip || null]);
  }
}
