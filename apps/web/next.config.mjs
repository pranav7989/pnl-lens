import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Docker image (no Vercel runtime).
  output: 'standalone',
  poweredByHeader: false,
  // Workspace packages ship TypeScript/ESM source; Next compiles them like app code.
  transpilePackages: ['@pnl-lens/engine', '@pnl-lens/shared'],
  // Trace dependencies from the monorepo root so the standalone bundle includes workspace packages.
  experimental: { outputFileTracingRoot: repoRoot },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
