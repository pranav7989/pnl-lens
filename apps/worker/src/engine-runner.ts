/**
 * @file  apps/worker/src/engine-runner.ts
 * @area  Worker
 * @what  Starts engine-child.js per job with a memory cap and a timeout; a hung or crashing parse fails that file, not the worker (plan D10).
 */
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { ChildInput, ChildOutput } from './engine-child.js';

/** `crashed` with oom=true: the file exhausted the memory cap (a file problem). Any other crash is an infrastructure fault. */
export type RunResult = ChildOutput | { ok: false; kind: 'timeout' | 'crashed'; message: string; fileIndex: null; oom?: boolean };

export interface RunnerOptions { childPath?: string; timeoutMs: number; memoryMb: number }

export const defaultChildPath = () => fileURLToPath(new URL('./engine-child.js', import.meta.url));

export function runEngineIsolated(input: ChildInput, opts: RunnerOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = fork(opts.childPath ?? defaultChildPath(), [], {
      execArgv: [`--max-old-space-size=${opts.memoryMb}`],
      serialization: 'advanced',                       // Buffers / Uint8Arrays cross the IPC channel as bytes
      env: { PNL_ENGINE_CHILD: '1', TZ: 'Asia/Kolkata', NODE_ENV: process.env.NODE_ENV ?? 'production', PATH: process.env.PATH ?? '' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let done = false, stderr = '', oom = false;
    const OOM = /heap out of memory|Allocation failed|ERR_WORKER_OUT_OF_MEMORY/i;
    // V8 prints the out-of-memory line first, then a long native stack: check every chunk, keep only the first part for the message
    child.stderr?.on('data', (d) => { const t = d.toString(); if (OOM.test(t)) oom = true; if (stderr.length < 2000) stderr += t; });
    const finish = (r: RunResult) => { if (done) return; done = true; clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, kind: 'timeout', message: 'timeout', fileIndex: null }), opts.timeoutMs);
    child.once('message', (m) => finish(m as ChildOutput));
    child.once('exit', (code, signal) => finish({ ok: false, kind: 'crashed', message: `exit ${code ?? signal}: ${stderr.trim().split('\n').slice(0, 3).join(' | ')}`.slice(0, 500),
      fileIndex: null, oom: oom || OOM.test(stderr) }));
    child.once('error', (e) => finish({ ok: false, kind: 'crashed', message: e.message, fileIndex: null }));
    child.send(input);
  });
}
