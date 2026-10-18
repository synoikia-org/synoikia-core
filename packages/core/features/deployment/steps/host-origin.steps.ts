import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { INITIALIZE, rawRequest } from './requests.js';

const state = new WeakMap<SynoikiaWorld, { answers: { status: number; text: string }[] }>();
const of = (world: SynoikiaWorld) => {
  let s = state.get(world);
  if (!s) state.set(world, (s = { answers: [] }));
  return s;
};

const initialize = (world: SynoikiaWorld, agent: string, slug: string, headers: Record<string, string>) =>
  rawRequest(world.mcpBase, `/${slug}`, {
    body: INITIALIZE,
    headers: { authorization: `Bearer ${world.agents.get(agent)!.token}`, ...headers },
  });

When(
  'agent {word} opens a session on {string} through the host name {string}',
  async (world: SynoikiaWorld, agent: string, slug: string, host: string) => {
    of(world).answers = [await initialize(world, agent, slug, { host })];
  },
);

When(
  'agent {word} opens a session on {string} from a page of {string}',
  async (world: SynoikiaWorld, agent: string, slug: string, origin: string) => {
    of(world).answers = [await initialize(world, agent, slug, { origin })];
  },
);

Then('agent {word} is refused because the host name or the origin is not allowed', (world: SynoikiaWorld) => {
  const [answer] = of(world).answers;
  expect(answer!.status).toBe(403);
  expect(answer!.text).toContain('Host or Origin not allowed; set PUBLIC_MCP_URL or MCP_ALLOWED_HOSTS');
});

Given(
  'the operator lists the host name {string} and sets the public address {string}',
  async (world: SynoikiaWorld, host: string, url: string) => {
    await world.restartCore({ MCP_ALLOWED_HOSTS: host, PUBLIC_MCP_URL: url });
  },
);

When(
  'agent {word} opens a session on {string} through {string}, {string}, {string} and {string}',
  async (world: SynoikiaWorld, agent: string, slug: string, a: string, b: string, c: string, d: string) => {
    of(world).answers = [];
    for (const host of [a, b, c, d]) of(world).answers.push(await initialize(world, agent, slug, { host }));
  },
);

Then('agent {word} gets a session each time', (world: SynoikiaWorld) => {
  expect(of(world).answers.map((a) => a.status)).toEqual([200, 200, 200, 200]);
});
