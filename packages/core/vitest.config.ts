import { quickpickle } from 'quickpickle';
import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';

// `pnpm test:coverage`: the security-critical modules must stay well covered. Floors are
// set a little under the measured coverage, so a change that drops it has to add tests.
const floor = (lines: number, functions: number, branches: number, statements: number) => ({
  lines,
  functions,
  branches,
  statements,
});

export default mergeConfig(
  shared,
  defineConfig({
    // A step may take 10 s: three scenarios of a file share the CPU. A @long-running step gets 20 s (the World).
    plugins: [quickpickle({ todoTags: ['@todo', '@wip', '@backlog'], stepTimeout: 10_000 })],
    test: {
      // Four test files at once: the fastest on a 4-core machine (178 s at 3, 154 s at 4, no gain above).
      maxWorkers: 4,
      // Feature files run as tests. Only they load the World, so test files keep their vi.mock calls.
      projects: [
        { extends: true, test: { name: 'unit', include: ['test/**/*.test.ts'] } },
        {
          extends: true,
          test: {
            name: 'features',
            include: ['../../features/*/*.feature'],
            exclude: [
              'test/**',
              '../../features/{catalogs,conformance,manifest,rules,runtime,upstream,build,release,scaffold,accessibility,audit,clients,my-instances,profile,roles,settings,shell,sign-in,users}/*.feature',
              '../../features/{instances,plugins}/portal-*.feature',
            ],
            setupFiles: ['features/support/index.ts'],
            // A @long-running scenario waits for real timers of core, such as the shortest approval expiry.
            testTimeout: 30_000,
            // Three scenarios of a file at once (about 12% faster than one; 2 and 5 were no faster). An @exclusive
            // scenario runs alone in its process (features/support/world.ts).
            sequence: { concurrent: true },
            maxConcurrency: 3,
          },
        },
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        reporter: ['text-summary', 'html'],
        thresholds: {
          'src/gate/**': floor(95, 98, 88, 93),
          'src/auth/**': floor(86, 82, 75, 82),
          'src/approvals/**': floor(96, 94, 86, 93),
          'src/sandbox/**': floor(95, 98, 76, 93),
          'src/crypto/**': floor(93, 86, 95, 92),
        },
      },
    },
  }),
);
