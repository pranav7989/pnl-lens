/**
 * @file  packages/shared/test/rbac.test.ts
 * @area  Tests
 * @what  Role permissions and error fingerprinting.
 */
import { describe, it, expect } from 'vitest';
import { can, assignable, PERMS, isStaff } from '../src/admin/rbac';
import { fingerprintOf } from '../src/admin/telemetry';

describe('role-based access', () => {
  it('owner sees all five tabs and can manage roles', () => {
    for (const p of ['tab:users', 'tab:finance', 'tab:errors', 'tab:support', 'tab:product', 'roles:manage'] as const) expect(can('owner', p)).toBe(true);
  });
  it('finance sees finance only; support never sees finance', () => {
    expect(PERMS.finance).toEqual(['tab:finance']);
    expect(can('support', 'tab:finance')).toBe(false); expect(can('admin', 'tab:finance')).toBe(false);
  });
  it('analyst sees metrics without personal data', () => {
    expect(can('analyst', 'tab:users')).toBe(true); expect(can('analyst', 'user:pii')).toBe(false); expect(can('analyst', 'user:lookup')).toBe(false);
  });
  it('only the owner can open the research tab and download datasets', () => {
    expect(can('owner', 'tab:research')).toBe(true); expect(can('owner', 'research:export')).toBe(true);
    for (const r of ['admin', 'support', 'finance', 'analyst', 'user'] as const) { expect(can(r, 'tab:research')).toBe(false); expect(can(r, 'research:export')).toBe(false); }
  });
  it('only owner and admin can open the blog tab and publish (REQ-7)', () => {
    for (const r of ['owner', 'admin'] as const) { expect(can(r, 'tab:blog')).toBe(true); expect(can(r, 'blog:publish')).toBe(true); }
    for (const r of ['support', 'finance', 'analyst', 'user'] as const) { expect(can(r, 'tab:blog')).toBe(false); expect(can(r, 'blog:publish')).toBe(false); }
  });
  it('customers have no admin access', () => {
    expect(isStaff('user')).toBe(false); expect(PERMS.user).toEqual([]);
  });
  it('admins cannot create owners', () => {
    expect(assignable('admin')).not.toContain('owner'); expect(assignable('owner')).toContain('owner'); expect(assignable('support')).toEqual([]);
  });
  it('error fingerprints group the same error despite changing ids', () => {
    expect(fingerprintOf('Report 4f9a1c2e88 not found', 'at x (a.js:10:5)')).toBe(fingerprintOf('Report 77aa1bc3d9 not found', 'at x (a.js:12:9)'));
    expect(fingerprintOf('Report not found', 'at x')).not.toBe(fingerprintOf('Payment failed', 'at x'));
  });
});
