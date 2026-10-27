/**
 * @file  packages/db/src/types.ts
 * @area  Database
 * @what  Kysely table types for the schema after migration 0019 (hand-written; every table is exercised through these types by test/db/*).
 */
import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

/** Postgres numeric: pg returns a string (exact); numbers are accepted on write. */
export type Numeric = ColumnType<string, number | string, number | string>;
export type NumericNull = ColumnType<string | null, number | string | null, number | string | null>;
/** timestamptz / date: pg returns Date; strings are accepted on write. */
export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type TimestampNull = ColumnType<Date | null, Date | string | null, Date | string | null>;
/** date: read as 'YYYY-MM-DD' text (see client.ts), never shifted by the process timezone. */
export type DateOnly = ColumnType<string | null, string | null, string | null>;
export type Json = ColumnType<unknown, string, string>;      // write JSON.stringify(...) text; jsonb is parsed on read
export type JsonNull = ColumnType<unknown | null, string | null, string | null>;
/** bigint columns come back as strings from pg. */
export type BigIntCol = ColumnType<string, number | string | bigint, number | string | bigint>;

export type UserRole = 'user' | 'owner' | 'admin' | 'support' | 'finance' | 'analyst';
export type UserStatus = 'active' | 'blocked' | 'deleted';
export type PlanId = 'single' | 'snapshot' | 'progress' | 'discipline';
export type AnalysisStatus = 'queued' | 'parsing' | 'analysing' | 'storing' | 'ready' | 'failed';
export type DetectedKind = 'sheet' | 'pdf' | 'docx' | 'doc' | 'rtf';
export type FileStatus = 'stored' | 'purged' | 'deleted';
export type AccessActor = 'user' | 'worker' | 'admin' | 'system';
export type AccessAction = 'write' | 'read' | 'decrypt' | 'delete';
export type ConsentPurpose = 'processing' | 'research';
export type DataRequestKind = 'export' | 'delete';
export type DataRequestStatus = 'pending' | 'processing' | 'done' | 'failed' | 'cancelled';
export type ParseOutcome = 'ok' | 'no_trades' | 'error' | 'timeout';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  country: string | null;
  email_verified_at: TimestampNull;
  created_at: Generated<Date>;
  last_login_at: TimestampNull;
  status: Generated<UserStatus>;
  google_sub: string | null;
  name: string | null;
  role: Generated<UserRole>;
  password_hash: string | null;
  password_set_at: TimestampNull;
  password_failed: Generated<number>;
  password_locked_until: TimestampNull;
  sessions_valid_after: TimestampNull;
  restricted_reason: string | null;
  restricted_at: TimestampNull;
  restricted_by: string | null;
}

export interface CreditsTable {
  user_id: string;
  balance: Generated<number>;
  updated_at: Generated<Date>;
}

export interface SubscriptionsTable {
  id: Generated<string>;
  user_id: string;
  plan_id: PlanId;
  reports_total: number;
  reports_used: Generated<number>;
  files_per_report: number;
  starts_at: Generated<Date>;
  ends_at: Timestamp;
  payment_id: string | null;
  created_at: Generated<Date>;
  granted_by: string | null;
  grant_reason: string | null;
}

export interface ReportsTable {
  id: Generated<string>;
  user_id: string;
  payment_id: string | null;
  report: JsonNull;
  file_names: string[];
  file_hashes: string[];
  market: string | null;
  currency: string | null;
  trade_count: number | null;
  net_pnl_minor: BigIntCol | null;
  created_at: Generated<Date>;
  expires_at: Timestamp;
  purged_at: TimestampNull;
  analysis_id: string | null;
  engine_version: string | null;
  subscription_id: string | null;
  title: string | null;
  month_label: string | null;
  used_fingerprints: Generated<string[]>;
  fingerprint: string | null;
}

export interface AnalysesTable {
  id: Generated<string>;
  user_id: string;
  target_report_id: string | null;
  status: Generated<AnalysisStatus>;
  error_code: string | null;
  error_message: string | null;
  currency_override: string | null;
  file_count: number;
  engine_version: string | null;
  payload: JsonNull;
  attempts: Generated<number>;
  created_at: Generated<Date>;
  started_at: TimestampNull;
  finished_at: TimestampNull;
  expires_at: Generated<Date>;
  report_id: string | null;
  claimed_at: TimestampNull;
}

export interface StatementFilesTable {
  id: Generated<string>;
  user_id: string;
  original_name: string;
  ext: string;
  detected_kind: DetectedKind;
  mime: string | null;
  size_bytes: BigIntCol;
  sha256: string;
  storage_key: string;
  enc_alg: Generated<string>;
  enc_key_id: string;
  wrapped_dek: Buffer | null;
  iv: Buffer | null;
  fingerprint: string | null;
  status: Generated<FileStatus>;
  created_at: Generated<Date>;
  delete_after: Generated<Date>;
  purged_at: TimestampNull;
  object_deleted_at: TimestampNull;
}

export interface AnalysisFilesTable {
  analysis_id: string;
  file_id: string;
  user_id: string;
  position: number;
}

export interface AnalysisFileReportsTable {
  analysis_id: string;
  position: number;
  file_id: string;
  user_id: string;
  payload: JsonNull;
}

export interface FileAccessLogTable {
  id: Generated<string>;
  file_id: string;
  owner_user_id: string | null;
  actor_kind: AccessActor;
  actor_user_id: string | null;
  action: AccessAction;
  reason: string | null;
  job_id: string | null;
  ip: string | null;
  created_at: Generated<Date>;
}

export interface ParseRunsTable {
  id: Generated<string>;
  file_id: string;
  analysis_id: string | null;
  engine_version: string;
  detected_broker: string | null;
  detected_format: string | null;
  column_mapping: JsonNull;
  warnings: JsonNull;
  sheet_count: number | null;
  trade_count: number | null;
  duration_ms: number | null;
  outcome: ParseOutcome;
  error_code: string | null;
  created_at: Generated<Date>;
}

export interface TradesTable {
  id: Generated<string>;
  analysis_id: string;
  user_id: string;
  source_file_id: string | null;
  seq: number;
  symbol: string;
  underlying: string | null;
  market: string | null;
  segment: string | null;
  kind: 'EQ' | 'FUT' | 'CE' | 'PE';
  option_type: ColumnType<'CE' | 'PE' | null, never, never>;   // generated column
  grp: string | null;
  family: string | null;
  direction: 'Long' | 'Short' | null;
  entry_date: DateOnly;
  exit_date: DateOnly;
  entry_hour: number | null;
  hold_days: NumericNull;
  sell_days: NumericNull;
  expiry: DateOnly;
  expiry_type: string | null;
  weekday: string | null;
  strike: NumericNull;
  qty: Numeric;
  open_qty: NumericNull;
  avg_buy: NumericNull;
  buy: NumericNull;
  sell: NumericNull;
  pnl: Numeric;
  net_est: NumericNull;
  pct: NumericNull;
  style: string | null;
  n_legs: number | null;
  mult: NumericNull;
  is_opt: boolean | null;
  currency: string;
  broker: string | null;
  source_row: string | null;
  fingerprint: string | null;
  engine_version: string;
}

export interface FillsTable {
  id: Generated<string>;
  analysis_id: string;
  user_id: string;
  source_file_id: string | null;
  seq: number;
  symbol: string;
  side: 'buy' | 'sell';
  qty: Numeric;
  price: NumericNull;
  fees: NumericNull;
  trade_date: DateOnly;
  trade_time: string | null;
  exchange: string | null;
  segment: string | null;
  order_ref: string | null;
  currency: string | null;
  source_row: string | null;
  engine_version: string;
}

export interface ReportMetricsTable {
  analysis_id: string;
  user_id: string;
  n: number;
  wins: number | null;
  losses: number | null;
  win_rate: NumericNull;
  payoff: NumericNull;
  profit_factor: NumericNull;
  realized: NumericNull;
  charges: NumericNull;
  other: NumericNull;
  net: NumericNull;
  from_date: DateOnly;
  to_date: DateOnly;
  source: 'tradebook' | 'statement' | null;
  market: string | null;
  currency: string;
  progress_score: NumericNull;
  extra: JsonNull;
  engine_version: string;
  created_at: Generated<Date>;
}

export interface ReportTraitsTable {
  analysis_id: string;
  user_id: string;
  trait_id: number;
  area: string;
  name: string;
  score: Numeric;
  level: 'Strong' | 'Clear' | 'Emerging' | null;
  is_primary: boolean;
  evidence: Json;
  engine_version: string;
}

export interface ConsentsTable {
  id: Generated<string>;
  user_id: string;
  purpose: ConsentPurpose;
  granted: boolean;
  policy_version: string;
  text_sha256: string;
  ip_hash: string | null;
  user_agent: string | null;
  created_at: Generated<Date>;
}

export interface UserConsentCurrentView {
  user_id: string;
  purpose: ConsentPurpose;
  granted: boolean;
  policy_version: string;
  created_at: Date;
}

export interface DataRequestsTable {
  id: Generated<string>;
  user_id: string;
  kind: DataRequestKind;
  status: Generated<DataRequestStatus>;
  result_key: string | null;
  error_code: string | null;
  requested_at: Generated<Date>;
  started_at: TimestampNull;
  completed_at: TimestampNull;
  expires_at: TimestampNull;
  enc_key_id: string | null;
  wrapped_dek: Buffer | null;
  iv: Buffer | null;
  size_bytes: BigIntCol | null;
}

export interface AuditLogTable {
  id: Generated<string>;
  user_id: string | null;
  action: string;
  meta: JsonNull;
  ip: string | null;
  user_agent: string | null;
  created_at: Generated<Date>;
}

/** REQ-7 blog (0019). The app role reads blog_public / blog_public_redirects only; writes go through blog_admin_* functions. */
export type BlogSite = 'india' | 'global' | 'both';
export type BlogStatus = 'draft' | 'scheduled' | 'published' | 'archived';
export interface BlogPostsTable {
  id: Generated<string>; slug: string; title: string; excerpt: string; body_md: string; body_html: string;
  cover_key: string | null; cover_alt: string | null; tags: string[]; site: BlogSite; status: BlogStatus;
  seo_title: string | null; meta_description: string | null; canonical_url: string | null; noindex: boolean; reading_minutes: number;
  author_id: string | null; published_at: Date | null; created_at: Generated<Date>; updated_at: Generated<Date>; deleted_at: Date | null;
}
export interface BlogPublicView {
  id: string; slug: string; title: string; excerpt: string; body_html: string; cover_key: string | null; cover_alt: string | null;
  tags: string[]; site: BlogSite; seo_title: string | null; meta_description: string | null; canonical_url: string | null;
  noindex: boolean; reading_minutes: number; published_at: Date; updated_at: Date;
}
export interface BlogPublicRedirectsView { old_slug: string; slug: string; site: BlogSite }

export interface ResearchExportsTable {
  id: Generated<string>;
  requested_by: string | null;
  status: Generated<'pending' | 'building' | 'ready' | 'failed'>;
  subjects: number | null; reports: number | null; trades: number | null;
  storage_key: string | null; enc_key_id: string | null; wrapped_dek: Buffer | null; iv: Buffer | null;
  size_bytes: BigIntCol | null;
  error: string | null;
  created_at: Generated<Date>;
  completed_at: TimestampNull;
  expires_at: TimestampNull;
  deleted_at: TimestampNull;
}

export interface ResearchInvitesTable {
  id: Generated<string>;
  user_id: string;
  sent_by: string | null;
  token_sha256: string;
  created_at: Generated<Date>;
  expires_at: Generated<Date>;
  answered_at: TimestampNull;
  answer: boolean | null;
  ip_hash: string | null;
}

export interface PlanRemindersTable {
  id: Generated<string>;
  user_id: string;
  report_id: string | null;
  remind_on: string;
  created_at: Generated<Date>;
  sent_at: TimestampNull;
  cancelled_at: TimestampNull;
}

export interface ResearchExportReportsTable {
  export_id: string;
  report: string;
  report_id: string;
}

export interface PlanSnapshotsTable {
  id: Generated<string>;
  user_id: string;
  report_id: string | null;
  generated_on: string;
  checkup_on: string;
  plan: unknown;
  created_at: Generated<Date>;
}

export interface TradeNotesTable {
  id: Generated<string>;
  user_id: string;
  trade_key: string;
  setup: string | null;
  tags: Generated<string[]>;
  emotion: string | null;
  note: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Database {
  trade_notes: TradeNotesTable;
  plan_snapshots: PlanSnapshotsTable;
  research_export_reports: ResearchExportReportsTable;
  plan_reminders: PlanRemindersTable;
  research_invites: ResearchInvitesTable;
  research_exports: ResearchExportsTable;
  users: UsersTable;
  credits: CreditsTable;
  subscriptions: SubscriptionsTable;
  reports: ReportsTable;
  analyses: AnalysesTable;
  statement_files: StatementFilesTable;
  analysis_files: AnalysisFilesTable;
  analysis_file_reports: AnalysisFileReportsTable;
  file_access_log: FileAccessLogTable;
  parse_runs: ParseRunsTable;
  trades: TradesTable;
  fills: FillsTable;
  report_metrics: ReportMetricsTable;
  report_traits: ReportTraitsTable;
  consents: ConsentsTable;
  user_consent_current: UserConsentCurrentView;
  data_requests: DataRequestsTable;
  audit_log: AuditLogTable;
  blog_posts: BlogPostsTable;
  blog_public: BlogPublicView;
  blog_public_redirects: BlogPublicRedirectsView;
}

export type Analysis = Selectable<AnalysesTable>;
export type Report = Selectable<ReportsTable>;
export type StatementFile = Selectable<StatementFilesTable>;
export type NewTrade = Insertable<TradesTable>;
export type NewReportMetrics = Insertable<ReportMetricsTable>;
export type NewReportTrait = Insertable<ReportTraitsTable>;
export type NewParseRun = Insertable<ParseRunsTable>;
export type NewFill = Insertable<FillsTable>;
