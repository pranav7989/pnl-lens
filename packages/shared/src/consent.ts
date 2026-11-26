/**
 * @file  packages/shared/src/consent.ts
 * @area  Core
 * @what  Consent wording and version (from consent-text.ts) plus the SHA-256 of the exact text, stored with each consent row.
 */
import crypto from 'node:crypto';

import { CONSENT_TEXT, type ConsentPurposeKey } from './consent-text';
export { CONSENT_POLICY_VERSION, CONSENT_TEXT, type ConsentPurposeKey } from './consent-text';
export const consentTextSha256 = (purpose: ConsentPurposeKey) => crypto.createHash('sha256').update(CONSENT_TEXT[purpose], 'utf8').digest('hex');
