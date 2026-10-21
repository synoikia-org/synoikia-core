import { quickpickle } from 'quickpickle';
import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';
import vite from './vite.config.ts';

export default mergeConfig(
  vite,
  defineConfig({
    plugins: [quickpickle({ todoTags: ['@todo', '@wip', '@backlog'] })],
    test: {
      projects: [
        { extends: true, test: { name: 'unit', environment: 'jsdom', include: ['test/**/*.test.ts'] } },
        {
          // The portal in Chromium against a real core, which the World imports from its sources (docs/workflow.md).
          extends: true,
          resolve: shared.resolve,
          ssr: shared.ssr,
          test: {
            name: 'features',
            environment: 'node',
            include: [
              '../../features/{accessibility,audit,clients,my-instances,profile,roles,settings,shell,sign-in,users}/*.feature',
              '../../features/{instances,plugins}/portal-*.feature',
            ],
            globalSetup: ['features/support/build-portal.ts'],
            setupFiles: ['features/support/index.ts'],
            execArgv: shared.test?.execArgv,
            maxWorkers: 3,
            testTimeout: 60_000,
          },
        },
      ],
    },
  }),
);
