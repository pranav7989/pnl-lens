/**
 * @file  packages/shared/src/file-crypto.ts
 * @area  Core
 * @what  Envelope encryption for raw statement files: AES-256-GCM with a random key per file, wrapped by a KEK from env (rule 7).
 */
/**
 * The api encrypts before anything reaches storage; the worker decrypts in memory (Phase 5). Storage never sees
 * plaintext. Stored object = ciphertext || 16-byte GCM tag. The per-file key (DEK) is wrapped with the KEK named by
 * FILE_KEK_ID (value in FILE_KEK_<ID>, 64 hex chars, .env only): wrapped = iv(12) || encrypted DEK(32) || tag(16).
 * Old KEKs stay in env under their own id until a re-wrap script has moved every file (enc_key_id says which).
 * Deleting wrapped_dek in the DB ("shredding") makes the object unreadable everywhere, backups included.
 */
import crypto from 'node:crypto';

export interface Kek { id: string; key: Buffer }
export interface EncryptedFile { body: Buffer; iv: Buffer; wrappedDek: Buffer; encKeyId: string; encAlg: 'AES-256-GCM' }

const KEK_ID = /^[a-z0-9]{1,16}$/;

/** Reads FILE_KEK_ID and every FILE_KEK_<ID> from env. Throws if the current one is missing or malformed. */
export function loadKeks(env: NodeJS.ProcessEnv = process.env): { current: Kek; all: Map<string, Kek> } {
  const all = new Map<string, Kek>();
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(/^FILE_KEK_([A-Z0-9]{1,16})$/);
    if (!m || m[1] === 'ID' || !v) continue;
    if (!/^[0-9a-f]{64}$/i.test(v)) throw new Error(`${k} must be 64 hex characters (32 bytes)`);
    all.set(m[1].toLowerCase(), { id: m[1].toLowerCase(), key: Buffer.from(v, 'hex') });
  }
  const id = (env.FILE_KEK_ID || '').toLowerCase();
  if (!KEK_ID.test(id)) throw new Error('FILE_KEK_ID must be set (letters/digits, e.g. k1)');
  const current = all.get(id);
  if (!current) throw new Error(`FILE_KEK_${id.toUpperCase()} is not set`);
  return { current, all };
}

export function encryptFile(plain: Buffer, kek: Kek): EncryptedFile {
  const dek = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const body = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  const wiv = crypto.randomBytes(12);
  const w = crypto.createCipheriv('aes-256-gcm', kek.key, wiv);
  w.setAAD(Buffer.from(`kek:${kek.id}`));
  const wrappedDek = Buffer.concat([wiv, w.update(dek), w.final(), w.getAuthTag()]);
  dek.fill(0);
  return { body, iv, wrappedDek, encKeyId: kek.id, encAlg: 'AES-256-GCM' };
}

export function decryptFile(body: Buffer, iv: Buffer, wrappedDek: Buffer, kek: Kek): Buffer {
  const w = crypto.createDecipheriv('aes-256-gcm', kek.key, wrappedDek.subarray(0, 12));
  w.setAAD(Buffer.from(`kek:${kek.id}`));
  w.setAuthTag(wrappedDek.subarray(wrappedDek.length - 16));
  const dek = Buffer.concat([w.update(wrappedDek.subarray(12, wrappedDek.length - 16)), w.final()]);
  const d = crypto.createDecipheriv('aes-256-gcm', dek, iv);
  d.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
  dek.fill(0);
  return plain;
}
