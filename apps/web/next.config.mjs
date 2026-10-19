import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
// Security headers and the CSP are set by Caddy for every response (infra/caddy/Caddyfile), since Phase 7.
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (no Vercel runtime).
  output: 'standalone',
  poweredByHeader: false,
  // Workspace packages ship TypeScript/ESM source; Next compiles them like app code.
  transpilePackages: ['@pnl-lens/engine', '@pnl-lens/shared'],
  // Trace dependencies from the monorepo root so the standalone bundle includes workspace packages.
  experimental: { outputFileTracingRoot: repoRoot },
};

export default nextConfig;
