import { Then } from 'quickpickle';
import { expect } from 'vitest';
import type { PluginAuthorWorld } from './world.js';

Then('the check passes', (world: PluginAuthorWorld) => {
  expect(world.problems()).toEqual([]);
  expect(world.last?.code).toBe(0);
});

Then('the check fails with {string}', (world: PluginAuthorWorld, problem: string) => {
  expect(world.last?.code).toBe(1);
  expect(world.problems()).toContain(problem);
});

Then('the check fails with only {string}', (world: PluginAuthorWorld, problem: string) => {
  expect(world.last?.code).toBe(1);
  expect(world.problems()).toEqual([problem]);
});

Then('the check fails with a problem that contains {string}', (world: PluginAuthorWorld, part: string) => {
  expect(world.last?.code).toBe(1);
  expect(
    world.problems().some((p) => p.includes(part)),
    world.problems().join('\n'),
  ).toBe(true);
});
