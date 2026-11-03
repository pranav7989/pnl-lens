/**
 * @file  tests/load/uploads.js
 * @area  Tests
 * @what  k6 scenario: N users each upload statements at the same moment and follow their analysis to ready (latency, time to ready, failures).
 */
/**
 * Run through tests/load/run.sh (k6 in its pinned container on the stack's edge network). Env: VUS (default 50),
 * ITERATIONS per user (default 2), BASE (default http://caddy:80), ORIGIN (default http://localhost:8080).
 * Files rotate between a CSV tradebook, an XLSX F&O statement and a PDF tradebook. HEAVY=1 uploads .load/heavy.csv instead
 * (a ~5 MB tradebook made by tests/load/run.sh --heavy).
 */
/* global __ENV, __VU, __ITER */
import http from 'k6/http';
import { check, sleep, fail } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://caddy:80';
const ORIGIN = __ENV.ORIGIN || 'http://localhost:8080';
const VUS = Number(__ENV.VUS || 50);
const tokens = JSON.parse(open('/load/tokens.json'));
const FILES = __ENV.HEAVY ? [{ name: 'heavy.csv', type: 'text/csv', data: open('/load/heavy.csv', 'b') }] : [
  ['zerodha_tradebook.csv', 'text/csv'],
  ['zerodha_fo_statement.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['zerodha_tradebook.pdf', 'application/pdf'],
].map(([name, type]) => ({ name, type, data: open(`/fixtures/${name}`, 'b') }));

const timeToReady = new Trend('analysis_time_to_ready', true);
const failed = new Rate('analysis_failed');
const readyCount = new Counter('analysis_ready');

export const options = {
  scenarios: {
    burst: { executor: 'per-vu-iterations', vus: VUS, iterations: Number(__ENV.ITERATIONS || 2), maxDuration: '20m' },
  },
  thresholds: {
    'http_req_failed{kind:upload}': ['rate<0.01'],
    'http_req_duration{kind:upload}': ['p(95)<3000'],
    'http_req_duration{kind:status}': ['p(95)<500'],
    analysis_failed: ['rate==0'],
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'max'],
};

export default function () {
  if (tokens.length < VUS) fail(`need ${VUS} tokens, have ${tokens.length}: node tests/load/prepare.mjs ${VUS}`);
  const headers = { Origin: ORIGIN, Cookie: `lens_session=${tokens[(__VU - 1) % tokens.length]}` };
  const f = FILES[(__VU + __ITER) % FILES.length];
  const up = http.post(`${BASE}/api/v1/analyses`, { consent: 'true', files: http.file(f.data, f.name, f.type) }, { headers, tags: { kind: 'upload' } });
  if (!check(up, { 'upload accepted (202)': (r) => r.status === 202 })) { failed.add(1); console.error(`upload ${up.status}: ${up.body}`); return; }
  const id = up.json('analysisId');
  const t0 = Date.now();
  while (Date.now() - t0 < 15 * 60 * 1000) {
    sleep(2);
    const s = http.get(`${BASE}/api/v1/analyses/${id}`, { headers, tags: { kind: 'status', name: 'GET /analyses/:id' } });
    const status = s.status === 200 ? s.json('status') : null;
    if (status === 'ready') { timeToReady.add(Date.now() - t0); readyCount.add(1); failed.add(0); return; }
    if (status === 'failed') { failed.add(1); console.error(`analysis ${id} failed: ${s.body}`); return; }
  }
  failed.add(1);
  console.error(`analysis ${id} not ready after 15 minutes`);
}
