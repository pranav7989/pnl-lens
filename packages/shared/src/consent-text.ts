/**
 * @file  packages/shared/src/consent-text.ts
 * @area  Core
 * @what  The exact consent sentences shown to users and their policy version (no Node imports, so the website can use them too).
 */
/**
 * Changing a sentence: bump CONSENT_POLICY_VERSION. Every consent row stores the version and the SHA-256 of the exact
 * sentence it was given for, so earlier consents stay valid for the wording people actually saw.
 * 22 Oct 2026 (owner): the required box also accepts the Terms of Service and Privacy Policy; the optional research
 * box reads more invitingly. Research consent stays separate, optional and unticked (DPDP Act / GDPR).
 */
export const CONSENT_POLICY_VERSION = '2026-10-22';
export const CONSENT_TEXT = {
  processing: 'I agree to the Terms of Service and Privacy Policy, and to PnL Lens processing these files to build my report.',
  research: 'Make my insights sharper: let PnL Lens learn from my trades, with my name and email removed. Optional — you can change this anytime.',
} as const;
export type ConsentPurposeKey = keyof typeof CONSENT_TEXT;
