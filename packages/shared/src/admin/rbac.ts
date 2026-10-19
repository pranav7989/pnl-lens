/**
 * @file  packages/shared/src/admin/rbac.ts
 * @area  Admin
 * @what  Roles and permissions (owner, admin, support, finance, analyst): the rules only. The guards live in apps/web and apps/api.
 */
/**
 * Role-based access control (moved from apps/web/lib/admin/rbac.ts). The role is read from the database on every
 * admin request (never trusted from the session token), so changes take effect immediately.
 * `plans:grant` (owner only) is the approved exception to rule 6 (plan D5); the DB re-checks it in admin_grant_plan().
 */
export type Role = 'user' | 'owner' | 'admin' | 'support' | 'finance' | 'analyst';
export type Perm = 'tab:users' | 'tab:finance' | 'tab:errors' | 'tab:support' | 'tab:product' | 'user:lookup' | 'user:pii' | 'roles:manage' | 'plans:grant' | 'tab:blog' | 'blog:publish' | 'tab:research' | 'research:export';

export const PERMS: Record<Role, Perm[]> = {
  // research datasets (19 Oct 2026): owner only — the files hold every opted-in trader's trades
  owner: ['tab:users', 'tab:finance', 'tab:errors', 'tab:support', 'tab:product', 'user:lookup', 'user:pii', 'roles:manage', 'plans:grant', 'tab:blog', 'blog:publish', 'tab:research', 'research:export'],
  // blog (REQ-7, owner Q7): owner and admin only; the database re-checks the role in blog_admin_* functions
  admin: ['tab:users', 'tab:errors', 'tab:support', 'tab:product', 'user:lookup', 'user:pii', 'roles:manage', 'tab:blog', 'blog:publish'],
  support: ['tab:errors', 'tab:support', 'user:lookup', 'user:pii'],
  finance: ['tab:finance'],
  analyst: ['tab:users', 'tab:product'],
  user: [],
};
export const can = (role: Role | null | undefined, perm: Perm) => !!role && PERMS[role]?.includes(perm);
export const isStaff = (role: Role | null | undefined) => !!role && role !== 'user';
/** Roles an actor may assign: owners assign any role; admins assign anything except owner. */
export const assignable = (actor: Role): Role[] => (actor === 'owner' ? ['user', 'owner', 'admin', 'support', 'finance', 'analyst'] : actor === 'admin' ? ['user', 'admin', 'support', 'finance', 'analyst'] : []);
