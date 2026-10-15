/**
 * @file  packages/shared/src/db.ts
 * @area  Core
 * @what  Minimal query interface (pg.Pool / pg.Client satisfy it) so shared SQL helpers work with the web pool and the API pool.
 */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}
