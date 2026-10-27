/**
 * @file  tests/stack/stack.test.ts
 * @area  Tests
 * @what  Dev stack checks: all services healthy, only Caddy published, internal network isolated, least-privilege DB/Redis/storage.
 */
/**
 * Run against a running stack:  npm run stack:up && npm run test:stack
 * Reads secrets from the repo-root .env (never prints them). Uses the docker CLI; storage permissions are
 * exercised with the official AWS CLI image attached to the internal network.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const ENV_FILE = path.join(ROOT, '.env');
const COMPOSE = path.join(ROOT, 'infra/compose.dev.yml');
const PROJECT = 'pnl-lens';
const INTERNAL = `${PROJECT}_internal`;
const BASE = `http://127.0.0.1:${process.env.HTTP_PORT || 8080}`;
const AWS_IMAGE = 'amazon/aws-cli:2.37.3';
const REDIS_IMAGE = 'redis:7.4.11-alpine';
const PG_IMAGE = 'postgres:16.14-bookworm';

const env: Record<string, string> = {};
for (const line of fs.readFileSync(ENV_FILE, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2];
}

const run = (cmd: string, args: string[], input?: string) => {
  const r = spawnSync(cmd, args, { input, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return { code: r.status ?? -1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};
const dc = (...args: string[]) => run('docker', ['compose', '--env-file', ENV_FILE, '-f', COMPOSE, ...args]);
/** psql from a separate container over the internal network — the same path the api and worker use. */
const psql = (user: string, password: string, sql: string) =>
  run('docker', ['run', '--rm', '--network', INTERNAL, '-e', `PGPASSWORD=${password}`, PG_IMAGE,
    'psql', '-h', 'postgres', '-U', user, '-d', 'lens', '-v', 'ON_ERROR_STOP=1', '-tAc', sql]);
/** psql inside the postgres container itself, over its local socket (no password given). */
const psqlLocal = (user: string, sql: string) =>
  dc('exec', '-T', 'postgres', 'psql', '-U', user, '-d', 'lens', '-tAc', sql);
const aws = (keyId: string | null, secret: string | null, args: string[], input?: string) =>
  run('docker', ['run', '--rm', '-i', '--network', INTERNAL,
    ...(keyId ? ['-e', `AWS_ACCESS_KEY_ID=${keyId}`, '-e', `AWS_SECRET_ACCESS_KEY=${secret}`] : []),
    '-e', 'AWS_DEFAULT_REGION=garage', '-e', 'AWS_EC2_METADATA_DISABLED=true',
    AWS_IMAGE, '--endpoint-url', 'http://garage:3900', ...(keyId ? [] : ['--no-sign-request']), ...args], input);
const tcpOpen = (port: number) => new Promise<boolean>((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port });
  const done = (v: boolean) => { s.destroy(); resolve(v); };
  s.setTimeout(1500, () => done(false)); s.once('connect', () => done(true)); s.once('error', () => done(false));
});

interface Svc { Service: string; State: string; Health: string; ExitCode: number; Publishers: { URL: string; PublishedPort: number; TargetPort: number }[] | null }
let services: Svc[] = [];

beforeAll(() => {
  const r = dc('ps', '-a', '--format', 'json');
  expect(r.code, r.err).toBe(0);
  services = r.out.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
});

describe('services', () => {
  const LONG = ['caddy', 'web', 'api', 'worker', 'postgres', 'redis', 'garage'];
  for (const name of LONG) {
    it(`${name} is running and healthy`, () => {
      const s = services.find((x) => x.Service === name);
      expect(s, `${name} not found`).toBeDefined();
      expect(s!.State).toBe('running');
      expect(s!.Health).toBe('healthy');
    });
  }
  for (const name of ['migrate', 'storage-init']) {
    it(`one-off job ${name} finished successfully`, () => {
      const s = services.find((x) => x.Service === name);
      expect(s, `${name} not found`).toBeDefined();
      expect(s!.State).toBe('exited');
      expect(s!.ExitCode).toBe(0);
    });
  }
});

describe('exposure: only Caddy is reachable from outside the Docker networks', () => {
  it('no service except caddy publishes a port, and caddy only on 127.0.0.1', () => {
    for (const s of services) {
      const published = (s.Publishers || []).filter((p) => p.PublishedPort > 0);
      if (s.Service === 'caddy') {
        expect(published.length).toBeGreaterThan(0);
        for (const p of published) expect(['127.0.0.1']).toContain(p.URL);
      } else expect(published, `${s.Service} publishes ${JSON.stringify(published)}`).toEqual([]);
    }
  });
  for (const [name, port] of [['web', 3000], ['api', 4000], ['postgres', 5432], ['redis', 6379], ['garage S3', 3900], ['garage admin', 3903]] as const) {
    it(`${name} (:${port}) is not reachable from the host`, async () => expect(await tcpOpen(port)).toBe(false));
  }
  it('the internal network has no route to the internet (Docker internal: true)', () => {
    expect(run('docker', ['network', 'inspect', INTERNAL, '--format', '{{.Internal}}']).out).toBe('true');
  });
  it('network membership matches the plan', () => {
    const nets = (svc: string) => {
      const id = dc('ps', '-a', '-q', svc).out.split(/\r?\n/)[0];
      return Object.keys(JSON.parse(run('docker', ['inspect', id, '--format', '{{json .NetworkSettings.Networks}}']).out)).sort();
    };
    const E = `${PROJECT}_edge`, I = INTERNAL;
    expect(nets('caddy')).toEqual([E]);
    expect(nets('api')).toEqual([E, I].sort());
    expect(nets('web')).toEqual([E]);                    // Phase 6: no database access, talks only to the api
    for (const s of ['worker', 'postgres', 'redis', 'garage']) expect(nets(s), s).toEqual([I]);
  });
  it('the worker cannot reach the internet', () => {
    const r = dc('exec', '-T', 'worker', 'node', '-e', "fetch('https://example.com',{signal:AbortSignal.timeout(5000)}).then(()=>process.exit(1),()=>process.exit(0))");
    expect(r.code).toBe(0);
  });
  it('the api can reach the internet (email, Google, Razorpay)', () => {
    const r = dc('exec', '-T', 'api', 'node', '-e', "fetch('https://example.com',{signal:AbortSignal.timeout(10000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))");
    expect(r.code).toBe(0);
  });
});

describe('through Caddy', () => {
  it('serves the web app', async () => {
    const res = await fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('PnL Lens');
    expect(res.headers.get('server')).toBeNull();
  });
  it('every /api/* path goes to the API; the web app has no API routes or DB credentials (Phase 6)', async () => {
    const me = await (await fetch(`${BASE}/api/me`)).json();           // old web route: now answered by the API (404 shape)
    expect(me.error).toBeDefined();
    const v1 = await (await fetch(`${BASE}/api/v1/me`)).json();
    expect(v1.user.id).toBe('00000000-0000-0000-0000-000000000001');
    const env = dc('exec', '-T', 'web', 'sh', '-c', 'env').out;
    expect(env).not.toMatch(/DATABASE_URL|LENS_APP_PASSWORD|SESSION_SECRET|FILE_KEK/);
  });
  it('the web app renders pages from API data (the dev user\'s dashboard)', async () => {
    const res = await fetch(`${BASE}/dashboard`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Your reports stay here until you delete them.');
  });
  it('routes /api/v1/* to the API', async () => {
    const res = await fetch(`${BASE}/api/v1/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  it('API readiness: Postgres as lens_app, Redis, storage', async () => {
    const res = await fetch(`${BASE}/api/v1/ready`);
    const body = await res.json();
    expect(body.checks).toEqual({ db: 'ok', redis: 'ok', storage: 'ok' });
    expect(res.status).toBe(200);
  });
});

describe('worker', () => {
  it('is ready: Postgres as lens_worker, Redis, storage, queue consumer', () => {
    const r = dc('exec', '-T', 'worker', 'node', '-e', "fetch('http://127.0.0.1:4100/health').then(r=>r.text()).then(t=>console.log(t))");
    expect(JSON.parse(r.out).checks).toEqual({ db: 'ok', redis: 'ok', storage: 'ok', queue: 'ok', engine: 'ok' });
  });
  it('runs in the pinned timezone Asia/Kolkata (plan D9)', () => {
    const r = dc('exec', '-T', 'worker', 'node', '-e', 'console.log(new Date(2024,0,1).getTimezoneOffset())');
    expect(r.out).toBe('-330');
  });
});

describe('Postgres least privilege', () => {
  it('lens_app logs in with its password and is not a superuser', () => {
    const r = psql('lens_app', env.LENS_APP_PASSWORD, "select current_user || ',' || rolsuper::text || ',' || rolcreaterole::text from pg_roles where rolname = current_user");
    expect(r.out).toBe('lens_app,false,false');
  });
  it('a wrong password is rejected', () => {
    const r = psql('lens_app', 'not-the-password', 'select 1');
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/password authentication failed/);
  });
  it('no password-less access, even from inside the postgres container', () => {
    const r = psqlLocal(env.POSTGRES_USER || 'lens_admin', 'select 1');
    expect(r.code).not.toBe(0);
  });
  it('lens_app cannot create tables (no DDL)', () => {
    const r = psql('lens_app', env.LENS_APP_PASSWORD, 'create table public.probe(x int)');
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/permission denied/);
  });
  it('lens_app cannot delete rows', () => {
    const r = psql('lens_app', env.LENS_APP_PASSWORD, 'delete from public.audit_log');
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/permission denied/);
  });
  it('lens_app can read its tables (seeded dev credits)', () => {
    const r = psql('lens_app', env.LENS_APP_PASSWORD, "select count(*) from public.credits where user_id = '00000000-0000-0000-0000-000000000001'");
    expect(r.out).toBe('1');
  });
  it('lens_worker logs in and cannot read users (no access to accounts, payments or credits)', () => {
    expect(psql('lens_worker', env.LENS_WORKER_PASSWORD, 'select current_user').out).toBe('lens_worker');
    const r = psql('lens_worker', env.LENS_WORKER_PASSWORD, 'select count(*) from public.users');
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/permission denied/);
  });
  it('lens_worker can read its job tables (migration 0009)', () => {
    const r = psql('lens_worker', env.LENS_WORKER_PASSWORD, 'select count(*) from public.analyses');
    expect(r.code, r.err).toBe(0);
  });
  it('the migrate job applied every migration (0014 or later) and the dev user has a plan (D6)', () => {
    // at least one: the save test below tops the dev user up with a second plan once the seeded one is used up
    expect(Number(psql('lens_app', env.LENS_APP_PASSWORD, "select count(*) from public.subscriptions where user_id = '00000000-0000-0000-0000-000000000001' and ends_at > now()").out)).toBeGreaterThanOrEqual(1);
    const r = psql(env.POSTGRES_USER || 'lens_admin', env.POSTGRES_PASSWORD, "select max(name) from public.schema_migrations");
    expect(r.out >= '0014_').toBe(true);
  });
});

describe('Redis', () => {
  it('rejects clients without the password', () => {
    const r = run('docker', ['run', '--rm', '--network', INTERNAL, REDIS_IMAGE, 'redis-cli', '-h', 'redis', 'ping']);
    expect(r.out + r.err).toMatch(/NOAUTH/);
  });
  it('accepts the password', () => {
    const r = run('docker', ['run', '--rm', '--network', INTERNAL, '-e', `REDISCLI_AUTH=${env.REDIS_PASSWORD}`, REDIS_IMAGE, 'redis-cli', '-h', 'redis', 'ping']);
    expect(r.out).toBe('PONG');
  });
  it('uses AOF persistence and noeviction (BullMQ requirement)', () => {
    const r = dc('exec', '-T', 'redis', 'redis-cli', 'config', 'get', 'maxmemory-policy');
    expect(r.out).toMatch(/noeviction/);
    expect(dc('exec', '-T', 'redis', 'redis-cli', 'config', 'get', 'appendonly').out).toMatch(/yes/);
  });
});

describe('storage (Garage, S3 API) least privilege', () => {
  const key = `stack-test/probe-${process.pid}.bin`;
  const API = [env.S3_API_ACCESS_KEY_ID, env.S3_API_SECRET_ACCESS_KEY] as const;
  const WORKER = [env.S3_WORKER_ACCESS_KEY_ID, env.S3_WORKER_SECRET_ACCESS_KEY] as const;
  it('api key can upload', () => {
    const r = aws(...API, ['s3', 'cp', '-', `s3://statements/${key}`], 'probe-content');
    expect(r.code, r.err).toBe(0);
  });
  it('api key cannot read files back', () => {
    const r = aws(...API, ['s3', 'cp', `s3://statements/${key}`, '-']);
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/AccessDenied|Forbidden|403/);
  });
  it('api key cannot list the bucket', () => {
    expect(aws(...API, ['s3', 'ls', 's3://statements/']).code).not.toBe(0);
  });
  it('anonymous requests are refused', () => {
    expect(aws(null, null, ['s3', 'cp', `s3://statements/${key}`, '-']).code).not.toBe(0);
  });
  it('worker key can read the file', () => {
    const r = aws(...WORKER, ['s3', 'cp', `s3://statements/${key}`, '-']);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe('probe-content');
  });
  it('worker key can delete the file (purge)', () => {
    expect(aws(...WORKER, ['s3', 'rm', `s3://statements/${key}`]).code).toBe(0);
  });
  it('neither key can create buckets', () => {
    expect(aws(...API, ['s3', 'mb', 's3://probe-bucket']).code).not.toBe(0);
    expect(aws(...WORKER, ['s3', 'mb', 's3://probe-bucket']).code).not.toBe(0);
  });
});

describe('API on the stack (Phase 4)', () => {
  const ORIGIN = `http://localhost:${process.env.HTTP_PORT || 8080}`;
  const FIXTURE = path.join(ROOT, 'packages/engine/test/fixtures/zerodha_tradebook.csv');
  let analysisId = '';

  it('is ready: Postgres (lens_app), Redis and storage all ok', async () => {
    const r = await fetch(`${BASE}/api/v1/ready`);
    expect(await r.json()).toEqual({ ok: true, checks: { db: 'ok', redis: 'ok', storage: 'ok' } });
  });
  it('refuses a cross-site upload (CSRF origin check)', async () => {
    const fd = new FormData(); fd.set('consent', 'true');
    const r = await fetch(`${BASE}/api/v1/analyses`, { method: 'POST', body: fd, headers: { origin: 'https://evil.example' } });
    expect(r.status).toBe(403);
  });
  it('accepts the dev site opened as 127.0.0.1 as well as localhost (same site, two origins)', async () => {
    const fd = new FormData();
    fd.set('consent', 'true');
    fd.set('files', new Blob([fs.readFileSync(FIXTURE)]), 'zerodha_tradebook.csv');
    const r = await fetch(`${BASE}/api/v1/analyses`, { method: 'POST', body: fd, headers: { origin: `http://127.0.0.1:${process.env.HTTP_PORT || 8080}` } });
    expect(r.status, await r.clone().text()).toBe(202);
  });
  it('accepts an upload through Caddy and queues a BullMQ job', async () => {
    const fd = new FormData();
    fd.set('consent', 'true');
    fd.set('files', new Blob([fs.readFileSync(FIXTURE)]), 'zerodha_tradebook.csv');
    const r = await fetch(`${BASE}/api/v1/analyses`, { method: 'POST', body: fd, headers: { origin: ORIGIN } });
    expect(r.status).toBe(202);
    analysisId = (await r.json()).analysisId;
    const keys = dc('exec', '-T', 'redis', 'redis-cli', '-a', env.REDIS_PASSWORD, '--no-auth-warning', 'exists', `bull:analyses:analysis-${analysisId}`);
    expect(keys.out).toBe('1');
  });
  it('the stored object is encrypted, and the worker key + file key decrypt it to the original', async () => {
    const row = psql(env.POSTGRES_USER || 'lens_admin', env.POSTGRES_PASSWORD,
      `select f.storage_key || ',' || encode(f.iv, 'hex') || ',' || encode(f.wrapped_dek, 'hex') || ',' || f.enc_key_id
         from analysis_files af join statement_files f on f.id = af.file_id where af.analysis_id = '${analysisId}'`);
    const [key, iv, wrapped, kekId] = row.out.split(',');
    expect(kekId).toBe(env.FILE_KEK_ID);
    const got = spawnSync('docker', ['run', '--rm', '--network', INTERNAL, '-e', `AWS_ACCESS_KEY_ID=${env.S3_WORKER_ACCESS_KEY_ID}`,
      '-e', `AWS_SECRET_ACCESS_KEY=${env.S3_WORKER_SECRET_ACCESS_KEY}`, '-e', 'AWS_DEFAULT_REGION=garage', '-e', 'AWS_EC2_METADATA_DISABLED=true',
      AWS_IMAGE, '--endpoint-url', 'http://garage:3900', 's3', 'cp', `s3://statements/${key}`, '-'], { maxBuffer: 20 * 1024 * 1024 });
    expect(got.status, String(got.stderr)).toBe(0);
    const plain = fs.readFileSync(FIXTURE);
    expect(got.stdout.includes(plain.subarray(0, 32))).toBe(false);
    const { decryptFile } = await import('../../packages/shared/src/file-crypto');
    const kek = { id: kekId, key: Buffer.from(env[`FILE_KEK_${kekId.toUpperCase()}`], 'hex') };
    expect(decryptFile(got.stdout, Buffer.from(iv, 'hex'), Buffer.from(wrapped, 'hex'), kek).equals(plain)).toBe(true);
  });
  it('reports the job status to the owner (the Phase 5 worker processes it)', async () => {
    const r = await fetch(`${BASE}/api/v1/analyses/${analysisId}`);
    expect(await r.json()).toMatchObject({ id: analysisId, status: expect.stringMatching(/^(queued|parsing|analysing|storing|ready)$/), fileCount: 1 });
  });
});

describe('worker on the stack (Phase 5)', () => {
  const ORIGIN = `http://localhost:${process.env.HTTP_PORT || 8080}`;
  const FIX = path.join(ROOT, 'packages/engine/test/fixtures');
  const golden = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/engine/test/golden/combo_tradebook_plus_other_account.json'), 'utf8')).report;
  let analysisId = '';

  it('worker is ready: Postgres as lens_worker, Redis, storage, queue', () => {
    const r = dc('exec', '-T', 'worker', 'node', '-e', "fetch('http://127.0.0.1:4100/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j.checks)))");
    expect(JSON.parse(r.out)).toEqual({ db: 'ok', redis: 'ok', storage: 'ok', queue: 'ok', engine: 'ok' });
  });
  it('two statements uploaded through Caddy become a ready analysis equal to the golden combined report', async () => {
    const fd = new FormData();
    fd.set('consent', 'true');
    fd.append('files', new Blob([fs.readFileSync(path.join(FIX, 'zerodha_tradebook.csv'))]), 'zerodha_tradebook.csv');
    fd.append('files', new Blob([fs.readFileSync(path.join(FIX, 'groww_pnl.csv'))]), 'groww_pnl.csv');
    const up = await fetch(`${BASE}/api/v1/analyses`, { method: 'POST', body: fd, headers: { origin: ORIGIN } });
    expect(up.status).toBe(202);
    analysisId = (await up.json()).analysisId;
    let s: any = null;
    for (let i = 0; i < 60; i++) {
      s = await (await fetch(`${BASE}/api/v1/analyses/${analysisId}`)).json();
      if (s.status === 'ready' || s.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(s.status).toBe('ready');
    expect(s.preview).toMatchObject({ positions: golden.m.n, currency: golden.m.currency, net: golden.m.net });
    const payload = psql(env.POSTGRES_USER || 'lens_admin', env.POSTGRES_PASSWORD, `select payload::text from analyses where id = '${analysisId}'`).out;
    expect({ ...JSON.parse(payload), generatedAt: '<normalised>' }).toEqual(golden);
  });
  it('the worker logged a read and a decrypt for each file', () => {
    const r = psql(env.POSTGRES_USER || 'lens_admin', env.POSTGRES_PASSWORD,
      `select string_agg(action, ',' order by id) from file_access_log where actor_kind = 'worker' and file_id in (select file_id from analysis_files where analysis_id = '${analysisId}')`);
    expect(r.out).toBe('read,decrypt,read,decrypt');
  });
  it('saving spends one report from the seeded dev plan and serves the report', async () => {
    // the dev volume persists between runs: give the dev user a fresh plan if earlier runs used it up
    psql(env.POSTGRES_USER || 'lens_admin', env.POSTGRES_PASSWORD, `insert into subscriptions (user_id, plan_id, reports_total, files_per_report, ends_at, grant_reason)
      select '00000000-0000-0000-0000-000000000001', 'snapshot', 5, 3, now() + interval '92 days', 'stack test'
      where not exists (select 1 from subscriptions where user_id = '00000000-0000-0000-0000-000000000001' and ends_at > now() and reports_used < reports_total)`);
    const save = await fetch(`${BASE}/api/v1/reports`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ analysisId }) });
    expect(save.status).toBe(201);
    const { id } = await save.json();
    const rep = await (await fetch(`${BASE}/api/v1/reports/${id}`)).json();
    expect(rep.report.m.n).toBe(golden.m.n);
    expect(rep.summary.monthLabel).toMatch(/^[A-Z]{3}-\d{2}$/);
  });
});

describe('exports bucket (Phase 7)', () => {
  const key = `probe/${Date.now()}`;
  const API = [env.S3_API_ACCESS_KEY_ID, env.S3_API_SECRET_ACCESS_KEY] as const;
  const WORKER = [env.S3_WORKER_ACCESS_KEY_ID, env.S3_WORKER_SECRET_ACCESS_KEY] as const;
  it('worker key can write an archive but cannot read it back', () => {
    expect(aws(...WORKER, ['s3', 'cp', '-', `s3://exports/${key}`], 'archive').code).toBe(0);
    expect(aws(...WORKER, ['s3', 'cp', `s3://exports/${key}`, '-']).code).not.toBe(0);
  });
  it('api key can read archives (downloads) but cannot write', () => {
    const r = aws(...API, ['s3', 'cp', `s3://exports/${key}`, '-']);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe('archive');
    expect(aws(...API, ['s3', 'cp', '-', `s3://exports/${key}-x`], 'nope').code).not.toBe(0);
  });
  it('worker key can delete expired archives; anonymous access is refused', () => {
    expect(aws(null, null, ['s3', 'cp', `s3://exports/${key}`, '-']).code).not.toBe(0);
    expect(aws(...WORKER, ['s3', 'rm', `s3://exports/${key}`]).code).toBe(0);
  });
});

describe('media bucket (REQ-7 blog images)', () => {
  const key = `probe-${Date.now()}.webp`;
  const API = [env.S3_API_ACCESS_KEY_ID, env.S3_API_SECRET_ACCESS_KEY] as const;
  const WORKER = [env.S3_WORKER_ACCESS_KEY_ID, env.S3_WORKER_SECRET_ACCESS_KEY] as const;
  it('api key can write and read media; the worker key and anonymous access cannot', () => {
    expect(aws(...API, ['s3', 'cp', '-', `s3://media/${key}`], 'img').code).toBe(0);
    expect(aws(...API, ['s3', 'cp', `s3://media/${key}`, '-']).out).toBe('img');
    expect(aws(...WORKER, ['s3', 'cp', `s3://media/${key}`, '-']).code).not.toBe(0);
    expect(aws(...WORKER, ['s3', 'cp', '-', `s3://media/${key}-w`], 'x').code).not.toBe(0);
    expect(aws(null, null, ['s3', 'cp', `s3://media/${key}`, '-']).code).not.toBe(0);
  });
  it('the API serves a missing image as 404 with no storage details', async () => {
    const r = await fetch(`${BASE}/api/v1/blog/media/${'0'.repeat(32)}.webp`);
    expect(r.status).toBe(404);
  });
  it('blog list, robots.txt and sitemap.xml are public', async () => {
    const list = await fetch(`${BASE}/api/v1/blog/posts?site=india`);
    expect(list.status).toBe(200);
    expect(list.headers.get('cache-control')).toBe('public, max-age=60');
    expect(await (await fetch(`${BASE}/robots.txt`)).text()).toContain('Sitemap:');
    expect(await (await fetch(`${BASE}/sitemap.xml`)).text()).toContain('/blog</loc>');
  });
});

describe('hardening (Phase 7)', () => {
  const inspect = (svc: string) => {
    const id = dc('ps', '-q', svc).out.split(/\r?\n/)[0];
    return JSON.parse(run('docker', ['inspect', id]).out)[0];
  };
  for (const svc of ['caddy', 'web', 'api', 'worker']) {
    it(`${svc}: read-only root filesystem, no new privileges, all capabilities dropped, memory limit`, () => {
      const c = inspect(svc);
      expect(c.HostConfig.ReadonlyRootfs).toBe(true);
      expect(c.HostConfig.SecurityOpt).toContain('no-new-privileges:true');
      expect(c.HostConfig.CapDrop).toEqual(['ALL']);
      expect(c.HostConfig.Memory).toBeGreaterThan(0);
    });
  }
  for (const svc of ['web', 'api', 'worker']) {
    it(`${svc} runs as a non-root user`, () => {
      expect(dc('exec', '-T', svc, 'id', '-u').out).not.toBe('0');
    });
  }
  it('security headers and CSP on every response (pages and API)', async () => {
    for (const p of ['/', '/api/v1/health']) {
      const h = (await fetch(`${BASE}${p}`)).headers;
      expect(h.get('content-security-policy'), p).toContain("default-src 'self'");
      expect(h.get('content-security-policy'), p).toContain("frame-ancestors 'none'");
      expect(h.get('x-frame-options'), p).toBe('DENY');
      expect(h.get('x-content-type-options'), p).toBe('nosniff');
      expect(h.get('strict-transport-security'), p).toMatch(/max-age=\d+/);
      expect(h.get('server'), p).toBeNull();
    }
  });

  it('Next image optimizer is closed (not used; next <= 15.5.27 advisory)', async () => {
    for (const q of ['/_next/image?url=%2Ficon.svg&w=64&q=75', '/_next/image']) expect((await fetch(`${BASE}${q}`)).status, q).toBe(404);
  });
});
