-- @file  packages/db/migrations/0009_files_analyses.sql
-- @area  Database
-- @what  Uploaded statement files (encrypted, 30-day life), analyses (server jobs), file links, file access log, parse runs.
-- ============================================================================
-- 0009 · Files and analyses (plan §6, §7, §10; parse_runs per D15)
--   statement_files : one row per uploaded broker statement. The bytes live in
--                     object storage, encrypted by the app (AES-256-GCM, per-file
--                     key wrapped by a KEK from env). Purging a file deletes the
--                     wrapped key too, so any copy left in a backup is unreadable.
--   analyses        : one server job = one engine run over 1..3 files. A draft
--                     until claimed into a report (0012); drafts live 24 h (D3).
--   analysis_files  : which files an analysis read. Adding a file to an existing
--                     report re-runs the engine on old + new files, so one file
--                     can belong to several analyses.
--   file_access_log : every write / read / decrypt / delete of a raw file (rule 7).
--   parse_runs      : one row per file per engine run: what was detected, how long
--                     it took, the outcome. Lets old files be re-run when the
--                     engine improves (while the raw file still exists).
-- ============================================================================

create table if not exists public.analyses (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  -- set when the upload adds files to an existing report (the "+" button); null for a new report
  target_report_id  uuid references public.reports(id) on delete cascade,
  status            text not null default 'queued'
                    check (status in ('queued', 'parsing', 'analysing', 'storing', 'ready', 'failed')),
  error_code        text,
  currency_override text check (currency_override is null or currency_override ~ '^[A-Z]{3,4}$'),
  file_count        int  not null check (file_count between 1 and 3),
  engine_version    text,
  payload           jsonb,                       -- ReportV1; nulled once claimed (the report keeps the copy)
  attempts          int  not null default 0 check (attempts >= 0),
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz,
  expires_at        timestamptz not null default now() + interval '24 hours',
  report_id         uuid references public.reports(id) on delete set null,   -- set when claimed
  claimed_at        timestamptz,
  constraint analyses_id_user unique (id, user_id),
  constraint analyses_ready_has_payload check (status <> 'ready' or payload is not null or claimed_at is not null),
  constraint analyses_failed_has_code check (status <> 'failed' or error_code is not null)
);
-- user's own list and the D11 daily limit (20 analyses per user per day)
create index if not exists analyses_user on public.analyses (user_id, created_at desc);
-- D11 "3 running at once": small partial index, only unfinished jobs
create index if not exists analyses_running on public.analyses (user_id)
  where status in ('queued', 'parsing', 'analysing', 'storing');
-- purge_drafts(): unclaimed analyses past their 24 h
create index if not exists analyses_drafts on public.analyses (expires_at) where claimed_at is null;
-- report -> analyses history (add-files flow, delete_report_v2)
create index if not exists analyses_report on public.analyses (report_id) where report_id is not null;

create table if not exists public.statement_files (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  original_name text not null check (char_length(original_name) between 1 and 255),
  ext           text not null check (ext in ('.xlsx', '.xls', '.csv', '.pdf', '.docx', '.doc')),
  detected_kind text not null check (detected_kind in ('sheet', 'pdf', 'docx', 'doc', 'rtf')),
  mime          text,
  size_bytes    bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key   text not null unique,            -- random; never derived from the file name
  enc_alg       text not null default 'AES-256-GCM',
  enc_key_id    text not null,                   -- which KEK wrapped the key (rotation)
  wrapped_dek   bytea,                           -- null once purged (crypto-shredding)
  iv            bytea,
  -- the file-set lock: hash of the trades inside the file (same rule as the offline tool),
  -- so a renamed or re-saved copy of the same statement matches. Set by the worker.
  fingerprint   text,
  status        text not null default 'stored' check (status in ('stored', 'purged', 'deleted')),
  created_at    timestamptz not null default now(),
  delete_after  timestamptz not null default now() + interval '30 days',   -- D3
  purged_at     timestamptz,
  -- set by the worker once the (already unreadable) object is removed from storage
  object_deleted_at timestamptz,
  constraint statement_files_id_user unique (id, user_id),
  constraint statement_files_key_present check (status <> 'stored' or (wrapped_dek is not null and iv is not null)),
  constraint statement_files_purged check ((status = 'stored') = (purged_at is null))
);
create index if not exists statement_files_user on public.statement_files (user_id, created_at desc);
-- purge_raw_files(): files past delete_after that are still stored
create index if not exists statement_files_due on public.statement_files (delete_after) where purged_at is null;
-- worker sweep: shredded files whose storage object still has to be removed
create index if not exists statement_files_sweep on public.statement_files (purged_at) where purged_at is not null and object_deleted_at is null;

create table if not exists public.analysis_files (
  analysis_id uuid not null,
  file_id     uuid not null,
  user_id     uuid not null,
  position    smallint not null check (position between 0 and 2),
  primary key (analysis_id, position),
  unique (analysis_id, file_id),
  -- composite keys: an analysis can only read files of the same user
  foreign key (analysis_id, user_id) references public.analyses (id, user_id) on delete cascade,
  foreign key (file_id, user_id) references public.statement_files (id, user_id) on delete cascade
);
-- "is this file still used by any analysis?" (purge_drafts)
create index if not exists analysis_files_file on public.analysis_files (file_id);

create table if not exists public.file_access_log (
  id            bigserial primary key,
  file_id       uuid not null,                   -- no FK: the log outlives the file row
  owner_user_id uuid,
  actor_kind    text not null check (actor_kind in ('user', 'worker', 'admin', 'system')),
  actor_user_id uuid,
  action        text not null check (action in ('write', 'read', 'decrypt', 'delete')),
  reason        text,
  job_id        text,
  ip            inet,
  created_at    timestamptz not null default now()
);
create index if not exists file_access_log_file on public.file_access_log (file_id, created_at);
create index if not exists file_access_log_owner on public.file_access_log (owner_user_id, created_at desc);

create table if not exists public.parse_runs (
  id              bigserial primary key,
  file_id         uuid not null references public.statement_files(id) on delete cascade,
  analysis_id     uuid references public.analyses(id) on delete set null,
  engine_version  text not null,
  detected_broker text,
  detected_format text,                          -- e.g. tradebook | statement | fills
  column_mapping  jsonb,                         -- engine `mapping` entries for this file (headers only, no data)
  warnings        jsonb,
  sheet_count     int,
  trade_count     int,
  duration_ms     int check (duration_ms is null or duration_ms >= 0),
  outcome         text not null check (outcome in ('ok', 'no_trades', 'error', 'timeout')),
  error_code      text,
  created_at      timestamptz not null default now()
);
create index if not exists parse_runs_file on public.parse_runs (file_id, created_at desc);
-- re-run campaigns: "files parsed by engine X that failed"
create index if not exists parse_runs_engine on public.parse_runs (engine_version, outcome);

-- ---- grants -----------------------------------------------------------------
-- api: creates uploads and analyses, reads its own rows (every query is scoped by user_id),
-- logs access. No UPDATE / DELETE: claiming and deleting go through SECURITY DEFINER functions.
grant select, insert on public.analyses, public.statement_files, public.analysis_files to lens_app;
grant select, insert on public.file_access_log to lens_app;        -- select: admin console
grant select on public.parse_runs to lens_app;                      -- admin console
grant usage on sequence public.file_access_log_id_seq to lens_app;

-- worker: reads jobs and file metadata, moves job status, records results.
grant select on public.analyses, public.statement_files, public.analysis_files, public.parse_runs to lens_worker;
grant update (status, error_code, engine_version, payload, attempts, started_at, finished_at) on public.analyses to lens_worker;
grant update (fingerprint, object_deleted_at) on public.statement_files to lens_worker;
grant insert on public.file_access_log, public.parse_runs to lens_worker;
grant usage on sequence public.file_access_log_id_seq, public.parse_runs_id_seq to lens_worker;
