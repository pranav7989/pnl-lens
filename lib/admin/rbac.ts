/**
 * @file  lib/admin/rbac.ts
 * @area  Admin
 * @what  Roles and permissions (owner, admin, support, finance, analyst) and the requirePerm() guard.
 */
/**
 * Role-based access control. The role is read from the database on every admin request
 * (never trusted from the session token), so changes take effect immediately.
 */
import { pool } from '@/lib/db';
import { getSessionUser } from '@/lib/auth/session';

export type Role = 'user' | 'owner' | 'admin' | 'support' | 'finance' | 'analyst';
export type Perm = 'tab:users' | 'tab:finance' | 'tab:errors' | 'tab:support' | 'tab:product' | 'user:lookup' | 'user:pii' | 'roles:manage';

export const PERMS: Record<Role, Perm[]> = {
  owner: ['tab:users', 'tab:finance', 'tab:errors', 'tab:support', 'tab:product', 'user:lookup', 'user:pii', 'roles:manage'],
  admin: ['tab:users', 'tab:errors', 'tab:support', 'tab:product', 'user:lookup', 'user:pii', 'roles:manage'],
  support: ['tab:errors', 'tab:support', 'user:lookup', 'user:pii'],
  finance: ['tab:finance'],
  analyst: ['tab:users', 'tab:product'],
  user: [],
};
export const can = (role: Role | null | undefined, perm: Perm) => !!role && PERMS[role]?.includes(perm);
export const isStaff = (role: Role | null | undefined) => !!role && role !== 'user';
/** Roles an actor may assign: owners assign any role; admins assign anything except owner. */
export const assignable = (actor: Role): Role[] => (actor === 'owner' ? ['user', 'owner', 'admin', 'support', 'finance', 'analyst'] : actor === 'admin' ? ['user', 'admin', 'support', 'finance', 'analyst'] : []);

export async function getRole(userId: string): Promise<Role> {
  if (process.env.AUTH_MODE === 'dev' && process.env.STORE_DRIVER !== 'pg') return 'owner';
  const { rows } = await pool().query('select role from public.users where id = $1', [userId]);
  return (rows[0]?.role as Role) || 'user';
}

/** For API routes: returns the staff member or a 401/403 Response. */
export async function requirePerm(perm: Perm): Promise<{ id: string; role: Role } | Response> {
  const u = await getSessionUser();
  if (!u) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const role = await getRole(u.id);
  if (!can(role, perm)) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  return { id: u.id, role };
}
