/**
 * @file  apps/worker/test/helpers.ts
 * @area  Tests
 * @what  Worker test helpers: encrypted uploads of real fixtures (as the API stores them), pipeline deps with the real engine child, golden cases.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createUpload } from '@pnl-lens/db';
import type { TestDb } from '@pnl-lens/db/testing';
import { encryptFile } from '@pnl-lens/shared/file-crypto';
import type { ReportV1 } from '@pnl-lens/engine/types';
import { memoryWorkerStorage } from '../src/storage.js';
import { runEngineIsolated, type RunResult } from '../src/engine-runner.js';
import { engineVersion } from '../src/engine-version.js';
import type { PipelineDeps } from '../src/pipeline.js';
import type { ChildInput } from '../src/engine-child.js';

export const FIX = path.resolve(__dirname, '../../../packages/engine/test/fixtures');
export const GOLDEN = path.resolve(__dirname, '../../../packages/engine/test/golden');
export const CHILD = path.resolve(__dirname, '../dist/engine-child.js');
export const KEK = { id: 'k1', key: crypto.createHash('sha256').update('worker-test-kek').digest() };

export interface GoldenCase { id: string; files: string[]; currency?: string; report: ReportV1 | null }
export const goldenCases = (): GoldenCase[] => fs.readdirSync(GOLDEN).filter((f) => f.endsWith('.json')).sort().map((f) => {
  const g = JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));
  return { id: g.case.id, files: g.case.files, currency: g.case.currency, report: g.report };
});

export interface Harness { objects: Map<string, Buffer>; deps: PipelineDeps; lastRun: { result: RunResult | null } }

export function harness(t: TestDb, runner: Partial<{ timeoutMs: number; memoryMb: number }> = {}): Harness {
  const objects = new Map<string, Buffer>();
  const lastRun = { result: null as RunResult | null };
  const deps: PipelineDeps = {
    db: t.worker, storage: memoryWorkerStorage(objects), keks: new Map([[KEK.id, KEK]]), engineVersion: engineVersion(),
    runEngine: async (input: ChildInput) => {
      lastRun.result = await runEngineIsolated(input, { childPath: CHILD, timeoutMs: runner.timeoutMs ?? 60_000, memoryMb: runner.memoryMb ?? 512 });
      return lastRun.result;
    },
  };
  return { objects, deps, lastRun };
}

/** Stores files the way the API does (encrypted, random key) and creates the analysis rows as lens_app. */
export async function uploadFiles(t: TestDb, h: Harness, userId: string, files: { name: string; bytes: Buffer }[],
  o: { currency?: string; targetReportId?: string; existingFileIds?: string[] } = {}) {
  const rows = files.map((f) => {
    const enc = encryptFile(f.bytes, KEK);
    const storageKey = `f/${crypto.randomUUID()}`;
    h.objects.set(storageKey, enc.body);
    return { originalName: f.name, ext: path.extname(f.name).toLowerCase(), detectedKind: 'sheet' as const, sizeBytes: f.bytes.length,
      sha256: crypto.createHash('sha256').update(f.bytes).digest('hex'), storageKey, encKeyId: enc.encKeyId, wrappedDek: enc.wrappedDek, iv: enc.iv };
  });
  return createUpload(t.app, { userId, files: rows, currencyOverride: o.currency ?? null, targetReportId: o.targetReportId ?? null, existingFileIds: o.existingFileIds });
}

export const fixture = (name: string, as = name) => ({ name: as, bytes: fs.readFileSync(path.join(FIX, name)) });
