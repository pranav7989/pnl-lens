/**
 * @file  apps/api/src/lib/storage.ts
 * @area  API
 * @what  Object storage (S3 API on Garage): encrypted statements (api key write-only), export archives (read-only), blog media (read/write, public via the API).
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
  /** media bucket (REQ-7 blog images): public content, never user files; served by GET /blog/media/:key. */
  putMedia(key: string, body: Buffer, contentType: string): Promise<void>;
  getMedia(key: string): Promise<{ body: Buffer; contentType: string } | null>;
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
    async putMedia(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: cfg.mediaBucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
    },
    async getMedia(key) {
      try {
        const r = await client.send(new GetObjectCommand({ Bucket: cfg.mediaBucket, Key: key }));
        return { body: Buffer.from(await r.Body!.transformToByteArray()), contentType: r.ContentType || 'application/octet-stream' };
      } catch (e: any) { if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) return null; throw e; }
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
export function memoryStorage(): Storage & { objects: Map<string, Buffer>; exports: Map<string, Buffer>; media: Map<string, { body: Buffer; contentType: string }> } {
  const objects = new Map<string, Buffer>(), exports = new Map<string, Buffer>(), media = new Map<string, { body: Buffer; contentType: string }>();
  return {
    objects, exports, media, async put(key, body) { objects.set(key, body); }, async check() { return 'ok'; },
    async getExport(key) { const b = exports.get(key); if (!b) throw new Error('NoSuchKey'); return b; },
    async putMedia(key, body, contentType) { media.set(key, { body, contentType }); },
    async getMedia(key) { return media.get(key) ?? null; },
  };
}
