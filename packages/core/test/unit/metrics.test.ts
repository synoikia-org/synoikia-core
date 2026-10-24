import { describe, expect, it } from 'vitest';
import { CoreEvents } from '../../src/events.js';
import type { InstanceManager } from '../../src/instances/manager.js';
import { appLabel, Metrics } from '../../src/metrics.js';

describe('appLabel', () => {
  it('keeps a plain app name', () => {
    expect(appLabel('claude-code', new Set())).toBe('claude-code');
  });

  it('lowers the case, drops other characters and cuts at 64 characters', () => {
    expect(appLabel('Cursor IDE', new Set())).toBe('cursoride');
    expect(appLabel('a"} 1\nevil{', new Set())).toBe('a1evil');
    expect(appLabel('x'.repeat(100), new Set())).toHaveLength(64);
  });

  it('counts an empty name as unknown', () => {
    expect(appLabel(undefined, new Set())).toBe('unknown');
    expect(appLabel('!!!', new Set())).toBe('unknown');
  });

  it('cuts a long name before it reads it', () => {
    expect(appLabel('A'.repeat(4_000_000), new Set())).toHaveLength(64);
  });

  it('keeps the first 32 names and counts later ones as other', () => {
    const known = new Set<string>();
    for (let i = 0; i < 32; i++) appLabel(`app-${i}`, known);
    expect(appLabel('app-0', known)).toBe('app-0');
    expect(appLabel('app-new', known)).toBe('other');
  });
});

describe('Metrics', () => {
  it('never throws into the emitter of an event', () => {
    const events = new CoreEvents();
    const broken = {
      slugs: () => {
        throw new Error('database closed');
      },
    } as unknown as InstanceManager;
    new Metrics(events, broken, () => new Date());
    expect(() => events.emit('approval.ended', { instanceId: 'i1', outcome: 'approved' })).not.toThrow();
  });
});
