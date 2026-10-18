import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { API_TOKEN } from '../../support/world.js';
import type { SynoikiaWorld } from '../../support/world.js';

const KB = 1024;
const run = (world: SynoikiaWorld, agent: string, code: string) => world.execute(agent, world.lastInstance, code);
const openTasks = (list: string) => `await tasks.call('lists.tasks', ${JSON.stringify({ list })})`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Given('a run on {string} may take {int} second', async (world: SynoikiaWorld, slug: string, seconds: number) => {
  await world.instanceSettings(slug, { sandbox: { timeoutMs: seconds * 1000 } });
});

Given('a run on {string} may use {int} MB of memory', async (world: SynoikiaWorld, slug: string, mb: number) => {
  await world.instanceSettings(slug, { sandbox: { memoryMb: mb } });
});

Given(
  'the add of {string} still waits after {int} seconds',
  async (world: SynoikiaWorld, title: string, seconds: number) => {
    await sleep(seconds * 1000);
    const rows = (await world.audit({ kind: 'call', decision: 'awaiting_approval' })) as {
      params?: { title?: string } | null;
    }[];
    expect(rows.some((r) => r.params?.title === title)).toBe(true);
    expect(world.upstreamRequests('POST', '/lists/Groceries/tasks')).toEqual([]);
  },
);

Given('Acme has a task in {string} whose title quotes the API token', (world: SynoikiaWorld, list: string) => {
  world.lists.get(list)!.push({ title: `token ${API_TOKEN} for the shop`, done: false });
});

Given(
  'the code of agent {word} left the global value {string} in an earlier run',
  async (world: SynoikiaWorld, agent: string, name: string) => {
    await run(
      world,
      agent,
      `globalThis[${JSON.stringify(name)}] = 42; return typeof globalThis[${JSON.stringify(name)}];`,
    );
    expect(world.answer).toEqual({ result: 'number' });
  },
);

When(
  'the code of agent {word} reads the open tasks of {string}, logs how many it found and returns the first',
  async (world: SynoikiaWorld, agent: string, list: string) => {
    await run(
      world,
      agent,
      `const open = ${openTasks(list)}; console.log('found', open.length, 'tasks'); return { first: open[0].title, count: open.length };`,
    );
  },
);

When(
  'the code of agent {word} counts the open tasks of {string} and returns nothing',
  async (world: SynoikiaWorld, agent: string, list: string) => {
    await run(world, agent, `await tasks.call('lists.count', ${JSON.stringify({ list })});`);
  },
);

When('the code of agent {word} throws the error {string}', async (world: SynoikiaWorld, agent: string, msg: string) => {
  await run(world, agent, `throw new Error(${JSON.stringify(msg)});`);
});

When('agent {word} sends code with broken syntax', async (world: SynoikiaWorld, agent: string) => {
  await run(world, agent, `await tasks.call('lists.count', { list: 'Groceries' }); return (`);
});

When('the code of agent {word} returns {int} KB of text', async (world: SynoikiaWorld, agent: string, size: number) => {
  await run(world, agent, `return 'x'.repeat(${size * KB});`);
});

When('the code of agent {word} logs {int} KB of text', async (world: SynoikiaWorld, agent: string, size: number) => {
  await run(world, agent, `for (let i = 0; i < ${size}; i++) console.log('y'.repeat(${KB})); return 'logged';`);
});

When(
  'the code of agent {word} returns the open tasks of {string} with {int} KB of padding',
  async (world: SynoikiaWorld, agent: string, list: string, size: number) => {
    await run(world, agent, `return { open: ${openTasks(list)}, padding: 'x'.repeat(${size * KB}) };`);
  },
);

When(
  'the code of agent {word} looks for modules, the process, the network and timers',
  async (world: SynoikiaWorld, agent: string) => {
    const names = ['require', 'module', 'process', 'Buffer', 'fetch', 'XMLHttpRequest', 'WebSocket', 'setTimeout'];
    await run(
      world,
      agent,
      `const found = []; let meta = 'none';
       try { meta = typeof eval('import.meta'); } catch (e) { meta = e.name; }
       ${JSON.stringify(names)}.forEach((n) => { if (typeof globalThis[n] !== 'undefined') found.push(n); });
       if (meta !== 'SyntaxError') found.push('import.meta');
       return found;`,
    );
  },
);

When(
  'the code of agent {word} builds new functions from the constructor of {string}',
  async (world: SynoikiaWorld, agent: string, fn: string) => {
    await run(
      world,
      agent,
      `const probes = [
         () => ${fn}.constructor('return typeof process')(),
         () => ${fn}.constructor.constructor('return typeof require')(),
         () => Object.getPrototypeOf(async () => {}).constructor('return typeof globalThis.process')(),
         () => typeof (function () { return this; })().process,
       ];
       const reached = [];
       for (const p of probes) {
         try { const v = await p(); if (v !== 'undefined') reached.push(String(v)); } catch (e) { reached.push('threw ' + e.message); }
       }
       return reached;`,
    );
  },
);

When(
  'the code of agent {word} searches the global scope for the helpers of core',
  async (world: SynoikiaWorld, agent: string) => {
    await run(
      world,
      agent,
      `const found = ['__syn', '__syn_call', '__syn_log', 'call', 'log', 'bind'].filter((n) => typeof globalThis[n] !== 'undefined');
       for (const k of Object.getOwnPropertyNames(globalThis)) {
         const v = globalThis[k];
         if (v && typeof v === 'object' && (typeof v.applySync === 'function' || typeof v.derefInto === 'function')) found.push(k);
       }
       return found;`,
    );
  },
);

When(
  'the code of agent {word} replaces {string} with its own function',
  async (world: SynoikiaWorld, agent: string, fn: string) => {
    await run(
      world,
      agent,
      `'use strict';
       try { ${fn} = () => 'replaced'; } catch (e) { return { refused: e.message, still: await ${fn}('lists.nothing', {}).catch((x) => x.code) }; }
       return { refused: null, still: await ${fn}('lists.count', { list: 'Groceries' }) };`,
    );
  },
);

When(
  'the code of agent {word} looks for the to-do functions that {string} inherits',
  async (world: SynoikiaWorld, agent: string, ns: string) => {
    await run(
      world,
      agent,
      `const proto = Object.getPrototypeOf(${ns});
       const inherited = ['constructor', 'hasOwnProperty', 'toString', '__proto__'].filter((n) => Object.hasOwn(${ns}, n));
       return { own: Object.keys(${ns}), inherited, protoCall: typeof proto.call, frozen: Object.isFrozen(${ns}) };`,
    );
  },
);

When('the code of agent {word} loops forever', async (world: SynoikiaWorld, agent: string) => {
  await run(world, agent, 'while (true) {}');
});

When(
  'the code of agent {word} counts the open tasks of {string} in a loop that never ends',
  async (world: SynoikiaWorld, agent: string, list: string) => {
    await run(world, agent, `for (;;) await tasks.call('lists.count', ${JSON.stringify({ list })});`);
  },
);

When('the code of agent {word} fills the memory without end', async (world: SynoikiaWorld, agent: string) => {
  await run(world, agent, 'const a = []; for (;;) a.push(new Array(1e6).fill(1));');
});

When(
  'the code of agent {word} looks for the global value {string}',
  async (world: SynoikiaWorld, agent: string, name: string) => {
    await run(world, agent, `return typeof globalThis[${JSON.stringify(name)}];`);
  },
);

Then(
  'agent {word} gets the first task {string} and the count {int}',
  (world: SynoikiaWorld, _agent: string, first: string, count: number) => {
    expect(world.answer).toMatchObject({ result: { first, count } });
  },
);

Then('agent {word} sees the log line {string}', (world: SynoikiaWorld, _agent: string, line: string) => {
  expect(world.answer.logs).toEqual([line]);
});

Then('agent {word} gets no value', (world: SynoikiaWorld) => {
  expect(world.answer).toEqual({ result: null });
});

Then('agent {word} is told that its code failed with {string}', (world: SynoikiaWorld, _agent: string, msg: string) => {
  expect(world.answer).toEqual({ error: 'CODE_ERROR', message: msg });
});

Then('agent {word} is told that its code has a syntax error', (world: SynoikiaWorld) => {
  expect(world.answer).toMatchObject({ error: 'SYNTAX_ERROR' });
});

Then('Acme received no request from agent {word}', (world: SynoikiaWorld) => {
  expect(world.upstream!.requests.filter((r) => r.headers['x-call-id'] !== undefined)).toEqual([]);
});

Then('agent {word} is told that the run went over its time limit', (world: SynoikiaWorld) => {
  // The run limit and the plugin call deadline end together, and either may answer first (plan: Deferred).
  expect([
    { error: 'TIMEOUT', message: 'Sandbox time limit exceeded' },
    { error: 'UPSTREAM_TIMEOUT', message: expect.stringMatching(/^Plugin did not answer invoke within \d+ ms$/) },
  ]).toContainEqual(world.answer);
});

Then('agent {word} is told that the run went over its memory limit', (world: SynoikiaWorld) => {
  expect(world.answer).toEqual({ error: 'MEMORY_LIMIT', message: 'Sandbox memory limit exceeded' });
});

Then(
  'agent {word} gets a cut result with its full size and a preview of {int} KB',
  (world: SynoikiaWorld, _agent: string, size: number) => {
    const result = world.answer.result as { truncated: boolean; bytes: number; preview: string };
    expect(world.answer.truncated).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBe(100 * KB + 2);
    expect(Buffer.byteLength(result.preview)).toBe(size * KB);
  },
);

Then('the logs of agent {word} stop at {int} KB', (world: SynoikiaWorld, _agent: string, size: number) => {
  expect(world.answer.result).toBe('logged');
  expect((world.answer.logs as string[]).join('').length).toBe(size * KB);
});

Then('the preview of agent {word} shows [REDACTED] in place of the API token', (world: SynoikiaWorld) => {
  const { preview } = world.answer.result as { preview: string };
  expect(world.answer.truncated).toBe(true);
  expect(preview).toContain('token [REDACTED] for the shop');
  expect(JSON.stringify(world.answer)).not.toContain(API_TOKEN);
});

Then('agent {word} finds none of them', (world: SynoikiaWorld) => {
  expect(world.answer).toEqual({ result: [] });
});

Then('the new functions of agent {word} find no process and no modules', (world: SynoikiaWorld) => {
  expect(world.answer).toEqual({ result: [] });
});

Then(
  'the code of agent {word} is refused, because {string} is read-only',
  (world: SynoikiaWorld, _agent: string, fn: string) => {
    const name = fn.split('.').at(-1)!;
    expect(world.answer).toEqual({
      result: {
        refused: expect.stringContaining(`read only property '${name}'`) as string,
        still: 'UNKNOWN_OPERATION',
      },
    });
  },
);

Then(
  'agent {word} finds only the to-do function {string}, and nothing inherited',
  (world: SynoikiaWorld, _agent: string, fn: string) => {
    expect(world.answer).toEqual({ result: { own: [fn], inherited: [], protoCall: 'undefined', frozen: true } });
  },
);

Then('agent {word} does not find {string}', (world: SynoikiaWorld) => {
  expect(world.answer).toEqual({ result: 'undefined' });
});
