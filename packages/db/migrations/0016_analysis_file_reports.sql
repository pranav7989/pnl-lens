-- @file  packages/db/migrations/0016_analysis_file_reports.sql
-- @area  Database
-- @what  Per-file dashboards: each statement's own report (ReportV1) for analyses with 2+ files, shown as file tabs next to "All files".
-- ============================================================================
-- 0016 · Per-file reports (Phase 6, workspace UI ported from the offline tool)
-- The offline tool shows each statement's own dashboard plus "All files". The
-- worker already analyses every file alone (for its file-set fingerprint); for an
-- analysis with 2 or more files it now keeps that result here. Single-file
-- analyses need no row: the file's report is the analysis payload itself.
-- payload is null when that file alone has no closed trades (the offline
-- "No closed trades found in <file>" panel). Rows go with their analysis.
-- ============================================================================
create table if not exists public.analysis_file_reports (
  analysis_id uuid not null references public.analyses(id) on delete cascade,
  position    smallint not null check (position between 0 and 2),
  file_id     uuid not null references public.statement_files(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  payload     jsonb,
  primary key (analysis_id, position)
);

grant select on public.analysis_file_reports to lens_app;
grant select, insert on public.analysis_file_reports to lens_worker;
