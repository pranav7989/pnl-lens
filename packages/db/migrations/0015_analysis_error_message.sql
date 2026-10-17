-- @file  packages/db/migrations/0015_analysis_error_message.sql
-- @area  Database
-- @what  analyses.error_message: the engine's own user-facing text for a failed file (e.g. scanned PDF), shown word for word.
-- ============================================================================
-- 0015 · Failed analyses keep the engine's message (Phase 4, rule 8)
-- The browser used to show the engine's exception text directly ("This PDF has no
-- readable text (it may be a scan)…"). With parsing on the server, the worker stores
-- that text here and the API returns it unchanged. error_code stays the stable key.
-- ============================================================================
alter table public.analyses add column if not exists error_message text
  check (error_message is null or char_length(error_message) <= 500);
grant update (error_message) on public.analyses to lens_worker;
