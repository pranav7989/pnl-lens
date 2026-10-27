/**
 * @file  packages/shared/test/password.test.ts
 * @area  Tests
 * @what  scrypt password hashing: round trip, wrong password, unique salts, the dummy hash never matches, and the password rules.
 */
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, passwordProblem, DUMMY_HASH } from '../src/auth/password';

describe('passwords', () => {
  it('hashes with scrypt and verifies only the right password', async () => {
    const h = await hashPassword('Correct horse 42');
    expect(h).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword('Correct horse 42', h)).toBe(true);
    expect(await verifyPassword('correct horse 42', h)).toBe(false);
    expect(await hashPassword('Correct horse 42')).not.toBe(h);              // a fresh salt each time
  });
  it('no stored hash, a broken hash or the dummy hash never verifies', async () => {
    expect(await verifyPassword('anything1', null)).toBe(false);
    expect(await verifyPassword('anything1', 'plain-text')).toBe(false);
    expect(await verifyPassword('anything1', DUMMY_HASH)).toBe(false);
  });
  it('rules: length, spaces, common and email-like passwords', () => {
    expect(passwordProblem('short')).toBe('Use at least 8 characters.');
    expect(passwordProblem('x'.repeat(129))).toBe('Use at most 128 characters.');
    expect(passwordProblem('        ')).toBe('The password can’t be only spaces.');
    expect(passwordProblem('Password123')).toMatch(/too easy/);
    expect(passwordProblem('rahul.k@gmail.com', 'Rahul.K@gmail.com')).toMatch(/too easy/);
    expect(passwordProblem('rahul.k1', 'rahul.k1@gmail.com')).toMatch(/too easy/);
    expect(passwordProblem('green-lamp-27')).toBeNull();
  });
});
