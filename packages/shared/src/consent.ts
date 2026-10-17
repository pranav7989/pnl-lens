/**
 * @file  packages/shared/src/consent.ts
 * @area  Core
 * @what  Upload consent wording (plan D2, W9/W10) and its version; the hash of the exact text is stored with each consent row.
 */
import crypto from 'node:crypto';

export const CONSENT_POLICY_VERSION = '2026-10';
export const CONSENT_TEXT = {
  processing: 'I agree to PnL Lens processing these files to build my report.',
  research: 'Also let PnL Lens use my data, anonymised, to improve its analysis. Optional — you can change this anytime.',
} as const;
export type ConsentPurposeKey = keyof typeof CONSENT_TEXT;
export const consentTextSha256 = (purpose: ConsentPurposeKey) => crypto.createHash('sha256').update(CONSENT_TEXT[purpose], 'utf8').digest('hex');
