import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./server/src/shared', import.meta.url)),
      '@': fileURLToPath(new URL('./web/src', import.meta.url)),
    },
  },
  esbuild: { jsx: 'automatic' },
  test: {
    // Node by default; a file that renders components opts into jsdom with a
    // `// @vitest-environment jsdom` docblock, so the other hundred stay fast.
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // better-sqlite3 is a native addon; forks keep each file's DB isolated.
    pool: 'forks',
    // Hashing dominates the suite otherwise; the algorithm under test is the same.
    env: { BCRYPT_COST: '4' },
  },
});
