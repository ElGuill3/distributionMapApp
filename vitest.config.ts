import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['frontend/src/ts/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['frontend/src/ts/**/*.ts'],
      exclude: ['frontend/src/ts/**/*.d.ts'],
    },
  },
});
