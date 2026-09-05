import type { NextConfig } from 'next';

const config: NextConfig = {
  // node:sqlite is a built-in; keep it out of the bundler.
  serverExternalPackages: ['node:sqlite'],
  experimental: { typedRoutes: false },
};

export default config;
