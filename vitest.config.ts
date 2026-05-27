import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    coverage: {
      provider: 'v8',
      thresholds: { lines: 70, functions: 70, branches: 70 },
      include: ['src/**/*.ts'],
      exclude: [
        'dist/**',
        '**/index.ts',
        'src/migrate.ts',
        'src/container.ts',
        'src/infrastructure/persistence/**',
        'src/infrastructure/config/**',
        'src/view/telegram/**',
        'src/domain/**',
      ],
    },
  },
});
