import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The workflow runner and scrypt hashing are CPU-bound; keep it modest.
    pool: 'threads',
  },
});
