/**
 * @file  apps/api/src/app.ts
 * @area  API
 * @what  Builds the Fastify app (/api/v1): cookies, multipart limits, rate limits, CSRF origin check, zod validation, OpenAPI, every route.
 */
import Fastify, { type FastifyInstance, type FastifyBaseLogger, type RawServerDefault, type RawRequestDefaultExpression, type RawReplyDefaultExpression } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { BlockList } from 'node:net';
import swagger from '@fastify/swagger';
import { serializerCompiler, validatorCompiler, jsonSchemaTransform, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Db } from '@pnl-lens/db';
import { captureErrorWith } from '@pnl-lens/shared/admin/telemetry';
import { MAX_FILES, MAX_FILE_BYTES } from '@pnl-lens/shared/limits';
import { sendMail, type Mail } from '@pnl-lens/shared/mail';
import type { Config } from './config.js';
import type { Storage } from './lib/storage.js';
import type { AnalysisQueue } from './lib/queue.js';
import { fail } from './lib/http.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { meRoutes } from './routes/me.js';
import { analysisRoutes } from './routes/analyses.js';
import { reportRoutes } from './routes/reports.js';
import { paymentRoutes } from './routes/payments.js';
import { adminRoutes } from './routes/admin.js';
import { telemetryRoutes } from './routes/telemetry.js';
import { blogRoutes } from './routes/blog.js';
import { researchRoutes } from './routes/research.js';
import { usersAdminRoutes } from './routes/users-admin.js';
import { planRoutes } from './routes/plan.js';
import { journalRoutes } from './routes/journal.js';
import { digestRoutes } from './routes/digest.js';

export interface Deps {
  config: Config;
  db: Db;
  pool: pg.Pool;
  storage: Storage;
  queue: AnalysisQueue;
  redis?: Redis | null;
  mail?: (m: Mail) => Promise<void>;
}

export type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, FastifyBaseLogger, ZodTypeProvider>
  & { deps: Required<Pick<Deps, 'mail'>> & Deps };

/** Paths that change state without a browser session: signature-checked by Razorpay. */
const CSRF_EXEMPT = new Set(['/api/v1/payments/webhook', '/api/payments/webhook']);
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Load tests only: addresses or CIDR ranges the rate limiter skips (RATE_LIMIT_EXEMPT_IPS; never set in compose.prod.yml). */
function exemptList(entries: string[] | undefined): BlockList | null {
  if (!entries?.length) return null;
  const list = new BlockList();
  for (const e of entries) {
    const [addr, bits] = e.split('/');
    const type = addr.includes(':') ? 'ipv6' : 'ipv4';
    if (bits) list.addSubnet(addr, Number(bits), type); else list.addAddress(addr, type);
  }
  return list;
}

export async function buildApp(deps: Deps): Promise<App> {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : {
      level: process.env.LOG_LEVEL || 'info',
      // never log cookies, auth headers or file names (plan §10 minimisation)
      redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-razorpay-signature"]'],
    },
    trustProxy: true,
    bodyLimit: 64 * 1024,                     // JSON bodies are small; uploads go through multipart limits
  }).withTypeProvider<ZodTypeProvider>() as unknown as App;
  app.decorate('deps', { mail: sendMail, ...deps });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      info: { title: 'PnL Lens API', version: '1.0.0', description: 'Backend v2 API. Session: httpOnly cookie `lens_session`.' },
      servers: [{ url: '/' }],
      components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'lens_session' } } },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(cookie);
  await app.register(multipart, {
    limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES, fields: 10, fieldSize: 1024, parts: MAX_FILES + 10, headerPairs: 200 },
  });
  const exempt = exemptList(deps.config.rateLimitExemptIps);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    ...(deps.redis ? { redis: deps.redis, nameSpace: 'rl:api:' } : {}),
    keyGenerator: (req) => req.ip,
    ...(exempt ? { allowList: (req: { ip: string }) => exempt.check(req.ip.replace(/^::ffff:/, ''), req.ip.includes(':') && !req.ip.startsWith('::ffff:') ? 'ipv6' : 'ipv4') } : {}),
    errorResponseBuilder: (_req, ctx) => ({ statusCode: ctx.statusCode, error: 'rate_limited', message: 'Too many requests. Try again in a minute.' }),
  });

  // CSRF: state-changing requests must come from our own pages. SameSite=Lax cookies already stop most cross-site
  // posts; this also refuses requests whose Origin (or Referer) is another site.
  app.addHook('onRequest', async (req, reply) => {
    if (!UNSAFE.has(req.method) || CSRF_EXEMPT.has(req.url.split('?')[0])) return;
    const src = (req.headers.origin as string | undefined) || (req.headers.referer as string | undefined);
    let origin: string | null = null;
    try { origin = src ? new URL(src).origin : null; } catch { origin = null; }
    const allowed = deps.config.allowedOrigins.length ? deps.config.allowedOrigins : [`${req.protocol}://${req.host}`];
    if (!origin || !allowed.includes(origin)) return fail(reply, 403, 'csrf', 'This request was blocked. Reload the page and try again.');
  });

  app.setErrorHandler(async (err: any, req, reply) => {
    if (err.statusCode === 429) return reply.code(429).send({ error: 'rate_limited', message: 'Too many requests. Try again in a minute.' });
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') return fail(reply, 413, 'file_too_large', 'Each file must be 10 MB or smaller.');
    if (err.code === 'FST_FILES_LIMIT' || err.code === 'FST_PARTS_LIMIT') return fail(reply, 400, 'too_many_files', `Upload up to ${MAX_FILES} broker statements at a time.`);
    if (err.code === 'FST_INVALID_MULTIPART_CONTENT_TYPE') return fail(reply, 415, 'invalid_upload', 'Send the files as a form upload.');
    if (err.validation) return fail(reply, 400, 'invalid', 'Bad request');
    if (err.statusCode && err.statusCode < 500) return fail(reply, err.statusCode, err.code || 'bad_request', err.message);
    req.log.error(err);
    await captureErrorWith(deps.pool, err, { source: 'server', route: `${req.method} ${req.routeOptions?.url ?? req.url}` });
    return fail(reply, 500, 'server_error', 'Something went wrong. Please try again.');
  });

  await app.register(async (v1) => {
    await healthRoutes(v1 as App, deps);
    await authRoutes(v1 as App, deps);
    await meRoutes(v1 as App, deps);
    await analysisRoutes(v1 as App, deps);
    await reportRoutes(v1 as App, deps);
    await paymentRoutes(v1 as App, deps);
    await adminRoutes(v1 as App, deps);
    await telemetryRoutes(v1 as App, deps);
    await blogRoutes(v1 as App, deps);
    await researchRoutes(v1 as App, deps);
    await usersAdminRoutes(v1 as App, deps);
    await planRoutes(v1 as App, deps);
    await journalRoutes(v1 as App, deps);
    await digestRoutes(v1 as App, deps);
    if (deps.config.exposeOpenApi) v1.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  }, { prefix: '/api/v1' });

  // Old external URLs stay valid at cutover (plan §8): Razorpay dashboard and Google console need no change.
  await app.register(async (legacy) => {
    await paymentRoutes(legacy as App, deps, { webhookOnly: true });
    await authRoutes(legacy as App, deps, { googleCallbackOnly: true });
  }, { prefix: '/api' });

  return app;
}
