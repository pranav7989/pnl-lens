/**
 * @file  apps/api/src/config.ts
 * @area  API
 * @what  API configuration from env, checked once at startup (fails fast on missing secrets).
 */
/**
 * Values the moved shared code reads itself (SESSION_SECRET, OTP_PEPPER, GOOGLE_*, MAIL_*, PAYMENTS_MODE,
 * RAZORPAY_*) stay in process.env; this module only checks that the ones the API cannot run without are present.
 */
import { loadKeks, type Kek } from '@pnl-lens/shared/file-crypto';

export interface Config {
  databaseUrl: string;
  redisUrl: string | null;
  s3: { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string } | null;
  keks: { current: Kek; all: Map<string, Kek> };
  ipHashSecret: string;
  /** Public origin(s) allowed to send state-changing requests (CSRF check). Empty = same host as the request. */
  allowedOrigins: string[];
  authMode: 'dev' | 'jwt';
  production: boolean;
  /** Serve /api/v1/openapi.json (dev only, plan §8). */
  exposeOpenApi: boolean;
}

const req = (env: NodeJS.ProcessEnv, k: string) => {
  const v = env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authMode = (env.AUTH_MODE || 'dev') === 'jwt' ? 'jwt' : 'dev';
  const production = env.NODE_ENV === 'production';
  if (authMode === 'jwt' && (env.SESSION_SECRET || '').length < 32) throw new Error('SESSION_SECRET must be set (32+ chars) when AUTH_MODE=jwt');
  if (authMode === 'jwt' && (env.OTP_PEPPER || '').length < 16) throw new Error('OTP_PEPPER must be set (16+ chars) when AUTH_MODE=jwt');
  const ipHashSecret = req(env, 'IP_HASH_SECRET');
  if (ipHashSecret.length < 32) throw new Error('IP_HASH_SECRET must be 32+ chars');
  const app = env.APP_URL ? new URL(env.APP_URL).origin : null;
  return {
    databaseUrl: req(env, 'DATABASE_URL'),
    redisUrl: env.REDIS_URL || null,
    s3: env.S3_ENDPOINT ? {
      endpoint: env.S3_ENDPOINT, region: env.S3_REGION || 'garage', bucket: req(env, 'S3_BUCKET'),
      accessKeyId: req(env, 'S3_ACCESS_KEY_ID'), secretAccessKey: req(env, 'S3_SECRET_ACCESS_KEY'),
    } : null,
    keks: loadKeks(env),
    ipHashSecret,
    allowedOrigins: [app, ...(env.EXTRA_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean)].filter((x): x is string => !!x),
    authMode,
    production,
    exposeOpenApi: !production || env.EXPOSE_OPENAPI === 'true',
  };
}
