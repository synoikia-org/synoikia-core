/** ADR-0020: how many broken messages one child may send in a window before core stops it. */
export class FrameBudget {
  private windowStart = Number.NEGATIVE_INFINITY;
  private count = 0;

  constructor(
    private readonly limit = 100,
    private readonly windowMs = 1000,
  ) {}

  /** Counts one broken message at `now`; false once the child is over its budget. */
  spend(now: number): boolean {
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.count = 0;
    }
    return ++this.count <= this.limit;
  }
}
