import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Route handlers (src/app/**) import via '@/', tests import them directly.
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The workflow runner and scrypt hashing are CPU-bound; keep it modest.
    pool: 'threads',
  },
});
