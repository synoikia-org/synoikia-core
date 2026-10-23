import { describe, expect, it } from 'vitest';
import { FrameBudget } from '../../src/plugins/frame-budget.js';

describe('FrameBudget', () => {
  it('allows the limit in one window and refuses the next message', () => {
    const budget = new FrameBudget(3, 1000);
    expect([0, 10, 20, 30].map((t) => budget.spend(t))).toEqual([true, true, true, false]);
  });

  it('starts again in the next window', () => {
    const budget = new FrameBudget(1, 1000);
    expect(budget.spend(0)).toBe(true);
    expect(budget.spend(999)).toBe(false);
    expect(budget.spend(1000)).toBe(true);
  });
});
