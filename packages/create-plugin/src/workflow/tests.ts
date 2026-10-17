import { matchesAny } from './glob.js';

/** New test files must be pure-function unit tests. Behavior is specified in feature files. */
export const unlistedTests = (added: readonly string[], unitTests: readonly string[]) =>
  added
    .filter((f) => /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(f) && !matchesAny(f, unitTests))
    .map(
      (f) =>
        `${f}: a new test file must be a pure-function unit test (${unitTests.join(', ')}). Specify behavior in a feature file`,
    );
