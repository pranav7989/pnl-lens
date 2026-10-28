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
  // No next/image anywhere: the image optimizer (/_next/image) stays off (defence in depth; the SVG RCE in next <= 15.5.27
  // is fixed in 15.5.28). Caddy also answers it with 404.
  images: { unoptimized: true },
  // Workspace packages ship TypeScript/ESM source; Next compiles them like app code.
  transpilePackages: ['@pnl-lens/engine', '@pnl-lens/shared'],
  // Trace dependencies from the monorepo root so the standalone bundle includes workspace packages.
  experimental: {
    outputFileTracingRoot: repoRoot,
    // the Terms and Privacy pages read the legal texts from docs/legal at runtime: bundle them into the image
    outputFileTracingIncludes: { '/terms': ['../../docs/legal/TERMS_OF_SERVICE.md'], '/privacy': ['../../docs/legal/PRIVACY_POLICY.md'] },
  },
};

export default nextConfig;
