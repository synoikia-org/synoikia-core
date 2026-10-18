import { expect } from 'vitest';
import type { SynoikiaWorld } from '../../support/world.js';
import { identity } from '../../identity/steps/identity.js';

/** The code of the refusal that the last kept portal answer gave. */
export const refusal = (world: SynoikiaWorld) => {
  const { answer } = identity(world);
  expect(answer.status, answer.text).toBeGreaterThanOrEqual(400);
  return answer.body.error;
};

/** The session grants on an instance, as the admin sees them. */
export const sessionGrants = async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  return (await world.expectOk(
    world.admin.get(`/api/instances/${id}/session-grants`),
    'list session grants',
  )) as unknown as { id: string; client: string | null }[];
};

/** The audit rows the admin finds with `query`, with the actor's name. */
export const auditRows = async (world: SynoikiaWorld, query: Record<string, string>) => {
  const qs = new URLSearchParams({ limit: '1000', ...query }).toString();
  return (await world.expectOk(world.admin.get(`/api/audit?${qs}`), 'read audit')).rows as {
    id: number;
    kind: string;
    decision: string;
    actorKind: string;
    actorId: string | null;
    actorName: string | null;
    actorDeleted: boolean;
    operationKey: string | null;
    detail: Record<string, unknown> | null;
  }[];
};

type AuditRow = Awaited<ReturnType<typeof auditRows>>[number];

/** What the administration steps keep between steps of one scenario. */
interface AdminState {
  /** The ids of people the admin deleted and then added again, by person. */
  formerIds: Map<string, string>;
  found: AuditRow[];
  csv: string;
  /** Anything else a step saw for a later step. */
  seen: Record<string, unknown>;
}

const states = new WeakMap<SynoikiaWorld, AdminState>();
export const admin = (world: SynoikiaWorld) => {
  let s = states.get(world);
  if (!s) states.set(world, (s = { formerIds: new Map(), found: [], csv: '', seen: {} }));
  return s;
};

/** The id of a role by its name, as the admin sees it. */
export const roleIdOf = async (world: SynoikiaWorld, name: string) => {
  const roles = (await world.expectOk(world.admin.get('/api/roles'), 'list roles')) as unknown as {
    id: string;
    name: string;
  }[];
  const role = roles.find((r) => r.name === name);
  if (!role) throw new Error(`no role "${name}"`);
  return role.id;
};

export interface LevelView {
  groups: { key: string; roleLevel: string | null; ownLevel: string | null }[];
  operations: {
    id: string;
    key: string;
    group: string | null;
    level: string;
    roleMax: string;
    ownLevel: string | null;
    reachable: boolean;
    reason: string | null;
  }[];
}

/** The maximum levels of a role on an instance, as the admin sees them. */
export const levelsOf = async (world: SynoikiaWorld, role: string, slug: string) => {
  const id = await world.tasksInstance(slug);
  return (await world.expectOk(
    world.admin.get(`/api/roles/${await roleIdOf(world, role)}/endpoints/${id}/access`),
    'read role levels',
  )) as unknown as LevelView;
};
