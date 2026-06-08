import { defineConfig } from '@rsbuild/core';
import path from 'path';

export default defineConfig({
  source: {
    entry: {
      index: './src/index.ts',
      'manual-job': './src/manual-job.ts',
      migrate: './src/migrate.ts',
      'audio-worker': './src/audio-worker.ts',
    },
    decorators: { version: 'legacy' },
  },
  tools: {
    rspack: {
      target: 'node',
      externalsPresets: { node: true },
      externals: {
        sqlite3: 'commonjs sqlite3',
        pino: 'commonjs pino',
      },
      optimization: {
        minimize: false,
      },
      builtins: {
        minifyOptions: {
          keep_classnames: true,
          keep_fnames: true,
        },
      },
    },
    swc: {
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
        },
        transform: {
          decoratorMetadata: true,
          legacyDecorator: true,
        },
      },
    },
  },
  output: {
    target: 'node',
    module: false,
    distPath: {
      root: 'dist',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
