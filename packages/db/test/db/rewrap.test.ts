/**
 * @file  packages/db/test/db/rewrap.test.ts
 * @area  Tests
 * @what  Key rotation: rewrap-keys.mjs moves every file key from k1 to k2; files still decrypt; dry run changes nothing; re-running is safe.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { encryptFile, decryptFile } from '@pnl-lens/shared/file-crypto';
import { createUpload } from '../../src/queries/analyses.js';
import { testDbAvailable, freshDb, makeUser, adminUrl, DB_PKG, type TestDb } from './harness.js';

const ok = await testDbAvailable();
const K1 = { id: 'k1', key: crypto.randomBytes(32) }, K2 = { id: 'k2', key: crypto.randomBytes(32) };
const run = (name: string, extra: string[] = []) => spawnSync(process.execPath, [path.join(DB_PKG, 'scripts/rewrap-keys.mjs'), ...extra], {
  encoding: 'utf8', env: { PATH: process.env.PATH, MIGRATE_DATABASE_URL: adminUrl(name), FILE_KEK_ID: 'k2', FILE_KEK_K1: K1.key.toString('hex'), FILE_KEK_K2: K2.key.toString('hex') },
});

describe.skipIf(!ok)('key rotation (rewrap-keys.mjs)', () => {
  let t: TestDb;
  const bodies = new Map<string, { body: Buffer; plain: Buffer }>();
  beforeAll(async () => {
    t = await freshDb('t_rewrap');
    const u = await makeUser(t);
    const files = [0, 1, 2].map((i) => {
      const plain = Buffer.from(`statement ${i} ` + crypto.randomUUID());
      const enc = encryptFile(plain, K1);
      const storageKey = `f/${crypto.randomUUID()}`;
      bodies.set(storageKey, { body: enc.body, plain });
      return { originalName: `s${i}.csv`, ext: '.csv', detectedKind: 'sheet' as const, sizeBytes: plain.length,
        sha256: crypto.createHash('sha256').update(plain).digest('hex'), storageKey, encKeyId: 'k1', wrappedDek: enc.wrappedDek, iv: enc.iv };
    });
    await createUpload(t.app, { userId: u, files });
  });
  afterAll(async () => { await t?.close(); });

  it('dry run reports but changes nothing', async () => {
    const r = run(t.name, ['--dry-run']);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).result.statement_files).toEqual({ rewrapped: 3, missingKey: 0, remaining: 3 });
  });

  it('re-wraps every key to the current KEK; the stored objects still decrypt; a second run is a no-op', async () => {
    const r = run(t.name);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).result.statement_files).toEqual({ rewrapped: 3, missingKey: 0, remaining: 0 });
    const rows = (await t.admin.query('select storage_key, enc_key_id, wrapped_dek, iv from statement_files')).rows;
    for (const row of rows) {
      expect(row.enc_key_id).toBe('k2');
      const { body, plain } = bodies.get(row.storage_key)!;
      expect(decryptFile(body, row.iv, row.wrapped_dek, K2).equals(plain)).toBe(true);
      expect(() => decryptFile(body, row.iv, row.wrapped_dek, K1)).toThrow();
    }
    expect((await t.admin.query(`select count(*)::int as n from audit_log where action = 'kek_rewrap'`)).rows[0].n).toBe(3);
    expect(JSON.parse(run(t.name).stdout).result.statement_files).toEqual({ rewrapped: 0, missingKey: 0, remaining: 0 });
  });
});
