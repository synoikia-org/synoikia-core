import { Then, When } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { admin } from './administration.js';

const portalOf = (world: SynoikiaWorld, user: number) => world.person(`user ${user}`).portal!;

When(
  'user {int} makes a credential for {string} and tries one for {string}',
  async (world: SynoikiaWorld, user: number, mine: string, other: string) => {
    const statuses: number[] = [];
    for (const slug of [mine, other]) {
      const res = await portalOf(world, user).post('/api/me/tokens', {
        name: `for ${slug}`,
        scope: [await world.tasksInstance(slug)],
      });
      statuses.push(res.status);
    }
    admin(world).seen.statuses = statuses;
  },
);

Then(
  'only the credential for {string} is made, and user {int} sees only that credential',
  async (world: SynoikiaWorld, slug: string, user: number) => {
    expect(admin(world).seen.statuses).toEqual([201, 400]);
    const listed = (await (await portalOf(world, user).get('/api/me/tokens')).json()) as { name: string }[];
    expect(listed.map((t) => t.name)).toEqual([`for ${slug}`]);
  },
);

const grantOf = async (world: SynoikiaWorld, user: number) => {
  const grants = (await world.expectOk(world.admin.get('/api/oauth/grants'), 'list grants')) as unknown as {
    id: string;
    revokedAt: string | null;
    user: { username: string };
  }[];
  return grants.find((g) => g.user.username === world.person(`user ${user}`).username)!;
};

When(
  'user {int} tries to revoke the credential of agent {word} and the grant of user {int}',
  async (world: SynoikiaWorld, user: number, agent: string, other: number) => {
    const portal = portalOf(world, user);
    const answers: unknown[] = [];
    for (const path of [
      `/api/me/tokens/${world.agents.get(agent)!.tokenId}`,
      `/api/me/grants/${(await grantOf(world, other)).id}`,
    ]) {
      const res = await portal.del(path);
      answers.push([res.status, ((await res.json()) as { error: string }).error]);
    }
    admin(world).seen.answers = answers;
  },
);

Then(
  'user {int} is told each time that there is no such credential or grant, and both still work',
  async (world: SynoikiaWorld) => {
    expect(admin(world).seen.answers).toEqual([
      [404, 'token_not_found'],
      [404, 'grant_not_found'],
    ]);
    expect((await grantOf(world, 15)).revokedAt).toBeNull();
    await world.call('7', 'count the tasks', { list: 'Groceries' });
    expect(world.answer.refused).toBeUndefined();
  },
);
