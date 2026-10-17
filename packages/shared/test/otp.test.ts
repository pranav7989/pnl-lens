/**
 * @file  packages/shared/test/otp.test.ts
 * @area  Tests
 * @what  Email one-time code helpers.
 */
import { describe, it, expect } from 'vitest';
import { generateCode, hashCode, codesMatch, normaliseEmail, maskEmail } from '../src/auth/otp';

describe('email one-time codes', () => {
  it('always 6 digits, well spread', () => {
    const codes = Array.from({ length: 2000 }, generateCode);
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(1990);
    expect(new Set(codes.map((c) => c[0])).size).toBe(10);
  });
  it('hash is bound to the email and never equals the code', () => {
    const h = hashCode('123456', 'a@b.com');
    expect(h).not.toContain('123456');
    expect(codesMatch('123456', 'a@b.com', h)).toBe(true);
    expect(codesMatch('123456', 'A@B.COM', h)).toBe(true);
    expect(codesMatch('123456', 'x@b.com', h)).toBe(false);
    expect(codesMatch('123457', 'a@b.com', h)).toBe(false);
  });
  it('normalises and validates emails', () => {
    expect(normaliseEmail('  Pranav@Gmail.COM ')).toBe('pranav@gmail.com');
    for (const bad of ['', 'nope', 'a@b', 'a b@c.com', 42, null, 'x'.repeat(300) + '@a.com']) expect(normaliseEmail(bad)).toBeNull();
  });
  it('masks emails for display', () => expect(maskEmail('pranav@gmail.com')).toBe('p*****@gmail.com'));
});
