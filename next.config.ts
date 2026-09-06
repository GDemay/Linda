import type { NextConfig } from 'next';

const config: NextConfig = {
  // node:sqlite is a built-in; keep it out of the bundler.
  serverExternalPackages: ['node:sqlite'],
  experimental: { typedRoutes: false },
  env: {
    // LIN-118: give the QA-harness flag a build-time value in every build so
    // `env` inlining turns the journeySpecEnabled guard into a compile-time
    // constant — without this, the unset variable stays a runtime lookup and
    // the toolbar ships (dead but unstripped) in production client bundles.
    NEXT_PUBLIC_JOURNEY_SPEC: process.env.NEXT_PUBLIC_JOURNEY_SPEC ?? '',
  },
};

export default config;
