import type { NextConfig } from 'next';

const config: NextConfig = {
  // node:sqlite is a built-in; keep it out of the bundler.
  serverExternalPackages: ['node:sqlite'],
  experimental: { typedRoutes: false },
  env: {
    // LIN-118: give the QA-harness flag a build-time value in every build so
    // `env` inlining turns the StateBar guard into a constant and minifier
    // dead-code eliminates the toolbar from production client bundles.
    NEXT_PUBLIC_QA_HARNESS: process.env.NEXT_PUBLIC_QA_HARNESS ?? '',
  },
};

export default config;
