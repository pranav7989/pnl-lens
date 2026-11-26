/**
 * @file  apps/worker/src/storage.ts
 * @area  Worker
 * @what  Object storage for the worker (S3 API on Garage): read encrypted files, delete shredded ones. In-memory version for tests.
 */
import { S3Client, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { WorkerConfig } from './config.js';

export interface WorkerStorage {
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  check(): Promise<string>;
  /** exports bucket (data-export archives): write-only for the worker, plus delete when they expire */
  putExport(key: string, body: Buffer): Promise<void>;
  deleteExport(key: string): Promise<void>;
}

export function s3WorkerStorage(cfg: WorkerConfig['s3']): WorkerStorage {
  const client = new S3Client({ endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } });
  return {
    async get(key) {
      const r = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    },
    async delete(key) { await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key })); },
    async putExport(key, body) { await client.send(new PutObjectCommand({ Bucket: cfg.exportBucket, Key: key, Body: body, ContentType: 'application/octet-stream', ContentLength: body.length })); },
    async deleteExport(key) { await client.send(new DeleteObjectCommand({ Bucket: cfg.exportBucket, Key: key })); },
    async check() {
      try { const res = await fetch(cfg.endpoint, { signal: AbortSignal.timeout(3000) }); return res.status < 500 ? 'ok' : `status_${res.status}`; }
      catch { return 'down'; }
    },
  };
}

/** Reads and deletes from a shared map (tests put objects in the same map the API's memory storage uses). */
export function memoryWorkerStorage(objects: Map<string, Buffer>, exports: Map<string, Buffer> = new Map()): WorkerStorage {
  return {
    async putExport(key, body) { exports.set(key, body); },
    async deleteExport(key) { exports.delete(key); },
    async get(key) { const b = objects.get(key); if (!b) throw Object.assign(new Error(`NoSuchKey: ${key}`), { name: 'NoSuchKey' }); return b; },
    async delete(key) { objects.delete(key); },
    async check() { return 'ok'; },
  };
}
