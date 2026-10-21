import { quickpickle } from 'quickpickle';
import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';

export default mergeConfig(
  shared,
  defineConfig({
    plugins: [quickpickle({ todoTags: ['@todo', '@wip', '@backlog'] })],
    test: {
      // Feature files run as tests (docs/workflow.md): plugin author 3 against the published SDK API.
      projects: [
        { extends: true, test: { name: 'unit', include: ['test/**/*.test.ts'] } },
        {
          extends: true,
          test: {
            name: 'features',
            include: ['../../features/{catalogs,conformance,manifest,rules,runtime,upstream}/*.feature'],
            exclude: ['test/**'],
            setupFiles: ['features/support/index.ts'],
          },
        },
      ],
    },
  }),
);
