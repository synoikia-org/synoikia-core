import { quickpickle } from 'quickpickle';
import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';

// The smoke test and the @long-running scenarios scaffold, build and test a plugin per template.
export default mergeConfig(
  shared,
  defineConfig({
    plugins: [quickpickle({ todoTags: ['@todo', '@wip', '@backlog'] })],
    test: {
      testTimeout: 180_000,
      hookTimeout: 180_000,
      // Feature files run as tests (docs/workflow.md): plugin author 3 runs the real commands as processes.
      projects: [
        { extends: true, test: { name: 'unit', include: ['test/**/*.test.ts'] } },
        {
          extends: true,
          test: {
            name: 'features',
            include: ['../../features/{build,release,scaffold,workflow}/*.feature'],
            exclude: ['test/**'],
            setupFiles: ['features/support/index.ts'],
            sequence: { concurrent: true },
            maxConcurrency: 3,
          },
        },
      ],
    },
  }),
);
