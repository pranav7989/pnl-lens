/**
 * @file  packages/shared/test/next.test.ts
 * @area  Tests
 * @what  safeNext(): same-site paths pass; every off-site trick (//, /\, tabs/newlines, schemes) falls back.
 */
import { describe, it, expect } from 'vitest';
import { safeNext } from '../src/auth/next';

describe('safeNext', () => {
  it('keeps same-site paths (with query and hash)', () => {
    expect(safeNext('/report/abc?x=1#t')).toBe('/report/abc?x=1#t');
    expect(safeNext('/upload')).toBe('/upload');
  });
  it('refuses anything that could leave the site', () => {
    for (const bad of ['//evil.com', '/\\evil.com', '/\\/evil.com', '/\t/evil.com', '/\n/evil.com', 'https://evil.com', 'javascript:alert(1)', 'evil.com', '', null, undefined, 42]) {
      expect(safeNext(bad), String(bad)).toBe('/dashboard');
    }
  });
});
