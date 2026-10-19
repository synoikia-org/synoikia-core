import { Then } from 'quickpickle';
import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';

Then(
  'the admin still has the user {string} with the role {string}, and the instance {string}',
  async (world: SynoikiaWorld, username: string, role: string, slug: string) => {
    const users = (await world.expectOk(world.admin.get('/api/users'), 'list users')) as unknown as {
      username: string;
      role: { name: string } | null;
    }[];
    expect(users.find((u) => u.username === username)?.role?.name).toBe(role);
    const instance = await world.expectOk(
      world.admin.get(`/api/instances/${world.instances.get(slug)!}`),
      'read instance',
    );
    expect(instance).toMatchObject({ slug, status: 'ready' });
  },
);
