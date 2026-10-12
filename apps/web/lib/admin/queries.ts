/**
 * @file  apps/web/lib/admin/queries.ts
 * @area  Admin
 * @what  SQL behind each admin tab, from packages/shared/src/admin/queries.ts, bound to the web app's pool.
 */
import { pool } from '@/lib/db';
import { adminQueries } from '@pnl-lens/shared/admin/queries';

const aq = () => adminQueries({ query: (text, params) => pool().query(text, params as unknown[]) });
export const usersTab = (pii: boolean) => aq().usersTab(pii);
export const financeTab = () => aq().financeTab();
export const errorsTab = () => aq().errorsTab();
export const supportTab = () => aq().supportTab();
export const userLookup = (email: string) => aq().userLookup(email);
export const productTab = () => aq().productTab();
