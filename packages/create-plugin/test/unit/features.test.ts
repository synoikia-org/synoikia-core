import { describe, expect, it } from 'vitest';
import { checkFeatures, checkSlice } from '../../src/workflow/features.js';

const file = (text: string, path = 'features/gate/deny.feature') => ({ path, text });

const GOOD = `@id:deny-writes
Feature: Deny writes
  An admin keeps agents from changing an instance.

  Rule: A read-only role cannot write

    Scenario: An agent with a read-only role tries to delete a pool
      Given agent 7 has the role "viewer" on instance "nas-01"
      When agent 7 deletes the pool "tank"
      Then agent 7 is told the role "viewer" cannot delete pools
      And the pool "tank" still exists

    @backlog
    Scenario: An agent with a write role deletes a pool
      Given agent 8 has the role "operator" on instance "nas-01"
      When agent 8 deletes the pool "tank"
      Then the pool "tank" is gone
`;

describe('checkFeatures', () => {
  it('accepts a feature in the rules', () => expect(checkFeatures([file(GOOD)])).toEqual([]));

  it('needs an @id and a Rule, and refuses comments and unknown tags', () => {
    const issues = checkFeatures([
      file(`@wip
Feature: Deny writes
  # why
  Scenario: Delete
    Given agent 7 has the role "viewer"
    When agent 7 deletes the pool "tank"
    Then agent 7 is told no
`),
    ]).join('\n');
    expect(issues).toMatch(/needs an @id/);
    expect(issues).toMatch(/put the scenario in a Rule/);
    expect(issues).toMatch(/no comments/);
    expect(issues).toMatch(/@wip is not allowed/);
  });

  it('refuses solution words, long scenarios and a missing When or Then', () => {
    const issues = checkFeatures([
      file(`@id:deny-writes
Feature: Deny writes
  Rule: Read-only roles cannot write
    Scenario: The endpoint answers 403
      Given agent 7 has the role "viewer"
      And the instance "nas-01" is online
      And the pool "tank" exists
      And the pool "tank" is empty
      When agent 7 sends a DELETE request
      Then the HTTP status code is 403

    Scenario: Nothing happens
      Given agent 7 has the role "viewer"
      Then nothing changes
`),
    ]).join('\n');
    expect(issues).toMatch(/names a solution \(endpoint\)/);
    expect(issues).toMatch(/names a solution \(DELETE\)/);
    expect(issues).toMatch(/names a solution \(HTTP\)/);
    expect(issues).toMatch(/has 6 steps/);
    expect(issues).toMatch(/needs one When and one Then/);
  });

  it('refuses an @id used twice', () => {
    expect(checkFeatures([file(GOOD), file(GOOD, 'features/other.feature')]).join()).toMatch(/also used at/);
  });

  it('reports a syntax error with its file', () => {
    expect(checkFeatures([file('Given x\n')])[0]).toMatch(/^features\/gate\/deny\.feature: \(1:1\)/);
  });
});

describe('checkSlice', () => {
  const unbacklogged = GOOD.replace('    @backlog\n', '');

  it('counts scenarios that leave the backlog or are new', () => {
    expect(checkSlice([file(GOOD)], [file(GOOD)])).toEqual([]);
    expect(checkSlice([file(GOOD)], [file(unbacklogged)])).toEqual([]);
  });

  it('refuses more than three scenarios', () => {
    const many =
      GOOD.replace('    @backlog\n', '') +
      ['A', 'B', 'C']
        .map(
          (x) => `
    Scenario: Case ${x}
      Given agent 9 has the role "viewer"
      When agent 9 deletes the pool "${x}"
      Then the pool "${x}" still exists
`,
        )
        .join('');
    expect(checkSlice([], [file(many)]).join()).toMatch(/builds 5 scenarios/);
  });

  it('refuses scenarios from two rules', () => {
    const two = `${GOOD}
  Rule: An owner can always read

    Scenario: The owner reads a pool
      Given agent 1 owns instance "nas-01"
      When agent 1 reads the pool "tank"
      Then agent 1 sees the pool "tank"
`;
    expect(checkSlice([], [file(two)]).join()).toMatch(/2 rules/);
  });
});
