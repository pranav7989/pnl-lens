# Load test (k6)

**Question:** what happens when 50 people upload statements at the same moment, and what worker settings suit the production VM (4 vCPU / 8 GB)?

**Answer:** nothing fails. Uploads stay fast because the API only stores and queues. The analyses wait in the queue and are worked off in order. `WORKER_CONCURRENCY=2` with `WORKER_MEM_LIMIT=2g` (the defaults) is the right setting: doubling the concurrency made the burst only 17% faster and nearly doubled the worker's memory. The API memory limit in production was raised from 768 MiB to 1 GiB for headroom.

## How it was run (2026-10-12)

- The full Docker stack (`infra/compose.dev.yml` + `infra/compose.load.yml`: real sessions, `AUTH_MODE=jwt`) on Docker Desktop with 8 CPUs and 7.7 GB. Same images and limits as production; Caddy on plain HTTP.
- 50 separate accounts (`tests/load/prepare.mjs`) so the per-user limits (3 running, 20 a day) apply as in real life. k6 1.3.0 runs in a container on the stack's network (`tests/load/run.sh`). The overlay lets the rate limiter skip Docker's private ranges, because all 50 users come from one IP here. Production always rate-limits.
- Each user: `POST /api/v1/analyses` (with consent), then `GET /api/v1/analyses/:id` every 2 s until `ready`. Memory sampled with `docker stats` every ~2 s.

## Results

| Run | Files | Worker concurrency | Uploads p95 | Status checks p95 | Analyses failed | Time to ready (median / max) | Burst finished after | Per-job processing (avg) | Peak memory (worker / api / postgres) |
|---|---|---|---|---|---|---|---|---|---|
| Light: 50 users × 2 uploads | CSV, XLSX and PDF fixtures (2–17 KB) | 2 | 469 ms | 21 ms | **0 of 100** | 6.0 s / 8.0 s | ~13 s | 0.22 s (queue wait avg 3.7 s) | 209 / 94 / 81 MiB |
| Heavy: 50 users × 1 upload | 5 MB tradebook CSV (59,000 rows) | 2 | 2.06 s | 8 ms | **0 of 50** | 2 min 22 s / 4 min 28 s | ~4 min 30 s | ~10 s | 854 / 549 / 210 MiB |
| Heavy, tuned | same | 4 (`WORKER_MEM_LIMIT=3g`) | 2.87 s | — | **0 of 50** | 1 min 38 s / 3 min 40 s | 3 min 41 s | 15 s | 1,542 / 486 / 259 MiB |

No HTTP request failed in any run (0 of 6,266). Every k6 threshold passed: upload errors < 1%, upload p95 < 3 s, status p95 < 500 ms, 0 failed analyses.

## What this means

- **Uploads never wait for analysis.** Even 50 simultaneous 5 MB uploads were all accepted within 3 s. The waiting happens in the queue, and the workspace's loader shows it. Real statements are usually far smaller than 5 MB (the light run is closer to normal traffic).
- **Concurrency.** With 4 parallel jobs, each job took 15 s instead of 10 s (the CPU and the database inserting tens of thousands of trade rows are shared), so the total gain was small. With 2 jobs, a 4 vCPU VM keeps two cores free for the API, web and Postgres.
- **Memory on an 8 GB VM (defaults):** worker ≤ 2 GiB (peak 0.85 GiB), api ≤ 1 GiB (peak 0.55 GiB), web 768 MiB, Postgres ≤ 2 GiB (peak 0.26 GiB), Redis and Garage 512 MiB each, Caddy 256 MiB: about 7 GiB at the limits, with the 4 GB swap behind it. The API peak comes from upload buffers (outside the Node heap) and is released after garbage collection.
- **When to change the settings:** if the queue regularly runs for minutes (worker logs `analysis_done` with high queue waits), move to a larger VM and raise `WORKER_CONCURRENCY` to 3 with `WORKER_MEM_LIMIT=2560m`. A 2 vCPU / 4 GB VM should use `WORKER_CONCURRENCY=1` and `WORKER_MEM_LIMIT=1g`.

## Re-running

```bash
docker compose --env-file .env -f infra/compose.dev.yml -f infra/compose.load.yml up -d --build --wait
node tests/load/prepare.mjs 50            # accounts + session tokens in .load/ (git-ignored); clears their earlier drafts
tests/load/run.sh 50 2                    # light: 50 users × 2 uploads
tests/load/run.sh --heavy 50 1            # heavy: a generated 5 MB tradebook per upload
WORKER_CONCURRENCY=4 WORKER_MEM_LIMIT=3g docker compose --env-file .env -f infra/compose.dev.yml -f infra/compose.load.yml up -d --wait worker
npm run stack:up                          # back to the normal dev stack
```

Results land in `.load/` (`summary.json`, `k6.log`, `stats.log`).
