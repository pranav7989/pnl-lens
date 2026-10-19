/**
 * @file  apps/worker/test/hostile.test.ts
 * @area  Tests
 * @what  Hostile files: a parse that runs too long is killed, one that exhausts memory crashes only its child; the worker carries on and the job fails cleanly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { testDbAvailable, freshDb, makeUser, type TestDb } from '@pnl-lens/db/testing';
import { runEngineIsolated } from '../src/engine-runner.js';
import { processAnalysis, FAILURE_MESSAGES } from '../src/pipeline.js';
import { CHILD, harness, uploadFiles, fixture } from './helpers.js';

/** ~9 MB CSV of plausible fills: fine for the real limits, far too much for a 40 MB heap. */
let big: Buffer | null = null;
const bigCsv = () => {
  if (big) return big;
  const lines = ['Symbol,Trade Date,Side,Quantity,Price,Order ID,Trade ID,Exchange,Segment,Remarks'];
  for (let i = 0; i < 120_000; i++) lines.push(`SYM${i % 900},2025-01-${String(1 + (i % 28)).padStart(2, '0')},${i % 2 ? 'BUY' : 'SELL'},${1 + (i % 50)},${100 + (i % 977)}.25,${1e9 + i},${2e9 + i},NSE,EQ,padding-padding-padding`);
  return (big = Buffer.from(lines.join('\n')));
};

/** A child that dies on start-up (e.g. a parser library missing from the image). */
const brokenChild = () => { const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pnl-child-')), 'broken.mjs'); fs.writeFileSync(p, "throw new Error('Cannot find package xlsx');\n"); return p; };

describe('engine runner limits (no database needed)', () => {
  it('a child that dies for another reason is reported as a crash that is not out of memory', async () => {
    const r = await runEngineIsolated({ files: [] }, { childPath: brokenChild(), timeoutMs: 10_000, memoryMb: 512 });
    expect(r).toMatchObject({ ok: false, kind: 'crashed', oom: false });
  });
  it('kills a parse that runs past the timeout', async () => {
    const r = await runEngineIsolated({ files: [{ name: 'big.csv', data: new Uint8Array(bigCsv()) }] }, { childPath: CHILD, timeoutMs: 150, memoryMb: 512 });
    expect(r).toMatchObject({ ok: false, kind: 'timeout' });
  });
  it('a parse that exhausts its memory cap crashes only the child', async () => {
    const r = await runEngineIsolated({ files: [{ name: 'big.csv', data: new Uint8Array(bigCsv()) }] }, { childPath: CHILD, timeoutMs: 60_000, memoryMb: 40 });
    expect(r).toMatchObject({ ok: false, kind: 'crashed', oom: true });
    // the parent is fine and the next job runs normally
    const ok = await runEngineIsolated({ files: [{ name: 'z.csv', data: new Uint8Array(fixture('zerodha_tradebook.csv').bytes) }] }, { childPath: CHILD, timeoutMs: 60_000, memoryMb: 512 });
    expect(ok.ok && ok.report?.m.n).toBe(96);
  });
});

const ok = await testDbAvailable();
describe.skipIf(!ok)('hostile files in the pipeline', () => {
  let t: TestDb;
  beforeAll(async () => { t = await freshDb('t_worker_hostile'); });
  afterAll(async () => { await t?.close(); });

  it('timeout and memory crash mark the analysis failed with a clear message (final, not retried)', async () => {
    const user = await makeUser(t);
    const slow = harness(t, { timeoutMs: 150 });
    const a = await uploadFiles(t, slow, user, [{ name: 'big.csv', bytes: bigCsv() }]);
    expect(await processAnalysis(slow.deps, a.analysisId)).toBe('failed');
    expect((await t.admin.query('select error_code, error_message from analyses where id = $1', [a.analysisId])).rows[0])
      .toEqual({ error_code: 'timeout', error_message: FAILURE_MESSAGES.timeout });

    const small = harness(t, { memoryMb: 40 });
    const b = await uploadFiles(t, small, user, [{ name: 'big.csv', bytes: bigCsv() }]);
    expect(await processAnalysis(small.deps, b.analysisId)).toBe('failed');
    expect((await t.admin.query('select error_code from analyses where id = $1', [b.analysisId])).rows[0].error_code).toBe('too_complex');
  });

  it('a broken engine (not the file) is an infrastructure error: thrown for retry, never a final file failure', async () => {
    const user = await makeUser(t);
    const h = harness(t);
    h.deps.runEngine = (input) => runEngineIsolated(input, { childPath: brokenChild(), timeoutMs: 10_000, memoryMb: 512 });
    const a = await uploadFiles(t, h, user, [fixture('zerodha_tradebook.csv')]);
    await expect(processAnalysis(h.deps, a.analysisId)).rejects.toThrow(/engine child crashed \(not a file problem\)/);
    expect((await t.admin.query('select status from analyses where id = $1', [a.analysisId])).rows[0].status).toBe('analysing');
  });
});
