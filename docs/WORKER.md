# Worker (apps/worker)

BullMQ consumer that turns uploaded statements into reports. It runs on the internal Docker network only (no internet), as the `lens_worker` database role, with `TZ=Asia/Kolkata` (plan D9). Built in backend-v2 Phase 5.

## One job

The queue is `analyses` and the job id is `analysis-<id>` (the API enqueues it after an upload).

1. **Load** the analysis and its files in upload order. A job whose analysis is already ready, failed or saved does nothing, so a re-delivered job is harmless.
2. **Fetch and decrypt** each file. It is read from storage with the worker's key and decrypted in memory with `FILE_KEK_<id>`. Each read and each decrypt is written to `file_access_log`, with the job id.
3. **Engine in a child process** (`engine-child.js`, one per job), capped at `ENGINE_MEMORY_MB` (512) and killed after `ENGINE_TIMEOUT_MS` (60 s).
   - The child runs exactly the parity path: every file through `fileToRawSheets` in order, then `analyzeRaw` over all sheets, so combined reports follow today's rules.
   - Each file is also analysed alone, only to compute its file-set fingerprint with the offline tool's rule (`tradeSetFingerprint`) and to record a parse run.
   - Fills come from the engine's own sheet parser.
   - The engine is not changed.
4. **Store** in one transaction: payload, trades, fills, metrics, traits, parse runs and file fingerprints. The status is then `ready`.

Status moves `queued` → `parsing` → `analysing` → `storing` → `ready` | `failed`; the API shows it at `GET /api/v1/analyses/:id`.

## Failures

| Kind | Example | What happens |
|---|---|---|
| The file | unreadable or scanned PDF, no closed trades, parse longer than 60 s, parse out of memory, files purged after 30 days | `failed` with `error_code` (`read_error`, `no_closed_trades`, `timeout`, `too_complex`, `files_expired`) and the engine's own sentence (or a fixed text) in `error_message`. **Final: not retried** |
| The infrastructure | storage or database down, a missing file key, the engine child dying for any reason other than running out of memory (for example a library missing from the image) | The job throws; BullMQ retries it 3 times with exponential backoff. After the last attempt (the dead letter) the job stays in BullMQ's failed set for 7 days, the analysis becomes `failed` / `internal_error`, and the error is written to `error_events` (admin Errors tab) |

**A failed file never costs a credit.** A report can only be created from a `ready` analysis (`create_report_from_analysis`), and the plan allowance is spent only then.

## Schedules (BullMQ job schedulers on queue `maintenance`)

| Job | When | Does |
|---|---|---|
| `nightly` | 02:00 Asia/Kolkata | `purge_raw_files()` (30 days, D3), `purge_drafts()` (24 h), `purge_otp_codes()` (7 days), then the sweep |
| `sweep` | every 15 min | Deletes the storage objects of shredded files and sets `object_deleted_at`. The API's storage key is write-only, so only the worker can delete. Also removes expired data-export archives and research datasets older than 90 days |
| `research` | 03:00 Asia/Kolkata on the 1st and 16th (also "Build now" in the admin console, job `research` on queue `data-requests`) | Research dataset (`src/research.ts`): reads the pseudonymised research views (users whose current research consent is yes) in one read-only snapshot, writes `subjects.csv`, `reports.csv`, `trades.csv`, `habits.csv` and a README, replaces internal report ids with per-export pseudonyms, zips, encrypts with the current KEK, stores under `research/` in the exports bucket and records `research_exports` (kept 90 days) |

Reports and trades are never purged by time (D4).

## engine_version

Every derived row carries `engine_version` = `e1-` plus the first 12 hex characters of a SHA-256 over the engine sources (`engine.js`, `behaviour.js`, `extract.js`, `index.ts`, `node.ts`) and the engine's `package.json`, so a parser-library change (for example SheetJS) also gives a new version. The build script fixes it in the image; dev and tests compute it from the files. Any engine change gives a new version, so rows from an older engine can be found, and their files re-run while they still exist (`parse_runs`).

## Settings

`DATABASE_URL` (lens_worker), `REDIS_URL`, `S3_*` (worker key: read and delete), `FILE_KEK_ID` and `FILE_KEK_<ID>` (every key still in use), `WORKER_CONCURRENCY` (2), `ENGINE_TIMEOUT_MS` (60000), `ENGINE_MEMORY_MB` (512). Health: `GET http://127.0.0.1:4100/health` inside the container. It checks the DB role, Redis, storage, the queue consumer, and an **engine self-test**: at start-up a two-line CSV goes through a real child process, so an image with a missing parser library never reports healthy.

## Code map

| File | What |
|---|---|
| `src/main.ts` | Process entry: config, role check, consumers, schedules, health |
| `src/queue-worker.ts` | BullMQ consumer and dead-letter handling |
| `src/pipeline.ts` | One job (fetch, decrypt, engine, store) and the failure rules |
| `src/engine-child.ts`, `src/engine-runner.ts` | The isolated engine run and its limits |
| `src/maintenance.ts` | Nightly purge and storage sweep |
| `src/research.ts` | Research dataset builder and its 90-day sweep |
| `src/storage.ts`, `src/config.ts`, `src/engine-version.ts` | Storage adapter, env checks, version hash |
| `scripts/build.mjs` | esbuild: `dist/main.js` + `dist/engine-child.js`. Engine libraries (SheetJS, pdf.js, cfb) stay external, installed in the image |
