/**
 * @file  packages/shared/src/auth/types.ts
 * @area  Auth
 * @what  Auth store interface and user/OTP types.
 */
export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  country: string | null;
  googleSub: string | null;
  status: 'active' | 'blocked' | 'deleted';
}

export interface OtpRow {
  id: string;
  userId: string;
  codeHash: string;
  attempts: number;
  expiresAt: string;
  consumedAt: string | null;
}

/** Persistence for sign-in. Same two drivers as the report store (STORE_DRIVER=file|pg). */
export interface AuthStore {
  upsertUserByEmail(email: string, country: string | null): Promise<UserRow>;
  upsertUserByGoogle(p: { sub: string; email: string; name: string | null; country: string | null }): Promise<UserRow>;
  markLogin(userId: string, method: 'email' | 'google' | 'password'): Promise<void>;
  countRecentOtps(p: { email?: string; ip?: string; sinceMinutes: number }): Promise<number>;
  createOtp(p: { userId: string; email: string; codeHash: string; purpose: 'login'; ttlMinutes: number; ip: string | null }): Promise<void>;
  latestOtp(email: string): Promise<OtpRow | null>;
  bumpOtpAttempts(id: string): Promise<number>;
  consumeOtp(id: string): Promise<boolean>;
  audit(userId: string | null, action: string, meta?: Record<string, unknown>, ip?: string | null): Promise<void>;
}
