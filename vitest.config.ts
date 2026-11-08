import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['@freequest/source'] },
  ssr: { resolve: { conditions: ['@freequest/source'] } },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
