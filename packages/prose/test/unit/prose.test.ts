import { describe, expect, it } from 'vitest';
import { checkProse } from '../../src/prose.js';

const long = Array.from({ length: 26 }, (_, i) => `word${i}`).join(' ');

describe('checkProse', () => {
  it('accepts short sentences', () => {
    expect(checkProse('a.md', '# Title\n\nRun the checks. Then push the branch.\n\n- Use one topic.\n')).toEqual([]);
  });

  it('refuses semicolons, em dashes and long sentences', () => {
    expect(checkProse('a.md', 'One thing; another.\n\nOne thing — another.\n\n' + long + '.\n')).toEqual([
      'a.md:1: no semicolons. Write two sentences',
      'a.md:3: no em dashes. Write two sentences or use a colon',
      'a.md:5: a sentence has 26 words. Use 25 at most',
    ]);
  });

  it('skips code, front matter, link targets and HTML comments', () => {
    const text = [
      '---',
      'description: a; b — c',
      '---',
      '```ts',
      'const a = 1; const b = 2;',
      '```',
      'Use `a; b` and [the guide](https://x.y/a;b).',
      '<!-- a; b -->',
    ].join('\n');
    expect(checkProse('a.md', text)).toEqual([]);
  });

  it('checks table cells for punctuation but not for length', () => {
    expect(checkProse('a.md', `| a | b |\n| - | - |\n| ${long} | x; y |\n`)).toEqual([
      'a.md:3: no semicolons. Write two sentences',
    ]);
  });

  it('joins wrapped lines and checks only touched blocks', () => {
    const text = `First line of a paragraph\ncontinues here; badly.\n\nAnother; one.\n`;
    expect(checkProse('a.md', text, new Set([1]))).toEqual(['a.md:1: no semicolons. Write two sentences']);
    expect(checkProse('a.md', text, new Set([4]))).toEqual(['a.md:4: no semicolons. Write two sentences']);
  });

  it('splits sentences after bold and code', () => {
    expect(checkProse('a.md', `**${long.slice(0, 60)}.** ${long.slice(0, 60)}.\n`)).toEqual([]);
  });

  it('checks feature files line by line', () => {
    expect(checkProse('x.feature', 'Feature: A; B\n  Scenario: x\n    Given a — b\n')).toEqual([
      'x.feature:1: no semicolons. Write two sentences',
      'x.feature:3: no em dashes. Write two sentences or use a colon',
    ]);
  });
});
