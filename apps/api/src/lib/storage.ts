/**
 * @file  apps/api/src/lib/storage.ts
 * @area  API
 * @what  Object storage for encrypted statement files (S3 API on Garage). The api's key is write-only by design.
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import type { Config } from '../config.js';

export interface Storage {
  /** Stores already-encrypted bytes. Never called with plaintext. */
  put(key: string, body: Buffer): Promise<void>;
  /** Readiness: the endpoint answers. */
  check(): Promise<string>;
  /** exports bucket: the api can only read finished data-export archives (written by the worker). */
  getExport(key: string): Promise<Buffer>;
}

export function s3Storage(cfg: NonNullable<Config['s3']>): Storage {
  const client = new S3Client({
    endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return {
    async put(key, body) {
      await client.send(new PutObjectCommand({
        Bucket: cfg.bucket, Key: key, Body: body, ContentType: 'application/octet-stream', ContentLength: body.length,
      }));
    },
    async getExport(key) {
      const r = await client.send(new GetObjectCommand({ Bucket: cfg.exportBucket, Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    },
    async check() {
      try {
        // Any HTTP answer (an unauthenticated request gets 403) means the S3 endpoint is up.
        const res = await fetch(cfg.endpoint, { signal: AbortSignal.timeout(3000) });
        return res.status < 500 ? 'ok' : `status_${res.status}`;
      } catch { return 'down'; }
    },
  };
}

/** Tests and local runs without storage: keeps objects in memory. */
export function memoryStorage(): Storage & { objects: Map<string, Buffer>; exports: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>(), exports = new Map<string, Buffer>();
  return {
    objects, exports, async put(key, body) { objects.set(key, body); }, async check() { return 'ok'; },
    async getExport(key) { const b = exports.get(key); if (!b) throw new Error('NoSuchKey'); return b; },
  };
}
