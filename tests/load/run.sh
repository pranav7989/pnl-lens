#!/usr/bin/env bash
# @file  tests/load/run.sh
# @area  Tests
# @what  Runs the k6 load test in its pinned container on the dev stack's edge network and samples worker/api memory while it runs.
# Usage: tests/load/run.sh [--heavy] [VUS=50] [ITERATIONS=2]     results: .load/summary.json, .load/stats.log, .load/k6.log
set -euo pipefail
cd "$(dirname "$0")/../.."
HEAVY=""; if [ "${1:-}" = "--heavy" ]; then HEAVY=1; shift; fi
VUS="${1:-50}"; ITERATIONS="${2:-2}"
K6_IMAGE=grafana/k6:1.3.0
if [ -n "$HEAVY" ] && [ ! -s .load/heavy.csv ]; then   # ~5 MB tradebook: the CSV fixture's rows repeated
  python3 -c 'import sys; h,*b=open(sys.argv[1]).read().splitlines(); r=[h]
while sum(map(len,r))<4.9e6: r+=b
open(sys.argv[2],"w").write("\n".join(r)+"\n")' packages/engine/test/fixtures/zerodha_tradebook.csv .load/heavy.csv
fi
[ -s .load/tokens.json ] || { echo "run: node tests/load/prepare.mjs $VUS"; exit 1; }
: > .load/stats.log
( while sleep 2; do docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' pnl-lens-worker-1 pnl-lens-api-1 pnl-lens-postgres-1 >> .load/stats.log 2>/dev/null || true; done ) &
SAMPLER=$!
trap 'kill $SAMPLER 2>/dev/null || true' EXIT
docker run --rm --network pnl-lens_edge -v "$PWD/.load:/load" -v "$PWD/packages/engine/test/fixtures:/fixtures:ro" -v "$PWD/tests/load:/scripts:ro" \
  -e VUS="$VUS" -e ITERATIONS="$ITERATIONS" -e HEAVY="$HEAVY" "$K6_IMAGE" run --quiet --summary-export /load/summary.json /scripts/uploads.js 2>&1 | tee .load/k6.log
echo "peak memory (MiB):"
awk '{split($3,a,"MiB"); split($3,g,"GiB"); m=(index($3,"GiB")?g[1]*1024:a[1]); if (m>peak[$1]) peak[$1]=m} END {for (k in peak) printf "  %s %.0f\n", k, peak[k]}' .load/stats.log
