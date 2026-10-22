const observers = new Set<() => void>();
let guarded = false;

/** ADR-0014: a child can signal its parent, and SIGUSR1 opens Node's debugger unless the process listens for it. */
export function guardDebugger(): void {
  if (guarded) return;
  guarded = true;
  process.on('SIGUSR1', () => {
    for (const fn of observers)
      try {
        fn();
      } catch {
        // A failing observer must not stop core.
      }
  });
}

/** Calls `fn` on each refused signal, until the returned function is called. */
export function onDebuggerRefused(fn: () => void): () => void {
  observers.add(fn);
  return () => {
    observers.delete(fn);
  };
}
