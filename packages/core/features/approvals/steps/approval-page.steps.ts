import { Given, Then, When } from 'quickpickle';
import { expect } from 'vitest';
import { csrfOf, eventually, opKey } from '../../support/world.js';
import type { PageResponse, SynoikiaWorld } from '../../support/world.js';

type Browser = ReturnType<SynoikiaWorld['pageBrowser']>;

/** What a step saw that a later step checks: the browser a person keeps open, and the pages it got. */
const seen = new WeakMap<
  SynoikiaWorld,
  { browser?: Browser; pagePath?: string; opened?: PageResponse; answer?: PageResponse; gatewayPage?: PageResponse }
>();
const seenBy = (world: SynoikiaWorld) => {
  let s = seen.get(world);
  if (!s) seen.set(world, (s = {}));
  return s;
};

type CallRow = {
  decision: string;
  decidedBy?: string | null;
  params?: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
};

const addsOf = async (world: SynoikiaWorld, title: string) =>
  ((await world.audit({ kind: 'call', operation: opKey('add a task') })) as CallRow[]).filter(
    (r) => r.params?.title === title,
  );

const expectWaiting = (world: SynoikiaWorld) =>
  expect(world.answer).toMatchObject({ status: 'awaiting_approval', approval: { url: expect.any(String) as string } });

/** `person` opens the approval link in a fresh browser and signs in; the browser stays open for later steps. */
const openSignedIn = async (world: SynoikiaWorld, person: string) => {
  const s = seenBy(world);
  s.browser = world.pageBrowser();
  s.pagePath = world.approvalLink();
  s.answer = await world.signInOnPage(s.browser.send, person, s.pagePath);
  s.opened = await s.browser.send(s.pagePath);
  return s;
};

/** The access gateway lets the browser through with an assertion of `claims`: a fresh browser, or the kept one. */
const throughGateway = async (world: SynoikiaWorld, claims: Record<string, unknown>, kept?: Browser) => {
  const assertion = { 'cf-access-jwt-assertion': await world.gatewayAssertion(claims) };
  const browser = kept ?? world.pageBrowser();
  seenBy(world).gatewayPage = await browser.send(world.approvalLink(), undefined, assertion);
};

const userIdentity = async (world: SynoikiaWorld, user: number) => {
  const person = world.people.get(`user ${user}`) ?? (await world.user(`user ${user}`, 'viewers'));
  return { sub: `acme-${user}`, email: person.username };
};

// ── calls that wait ──

Given(
  'agent {word} waits for the admin to approve renaming {string} to {string} with the share password {string}',
  async (world: SynoikiaWorld, agent: string, list: string, name: string, sharePassword: string) => {
    await world.call(agent, 'rename a list', { list, name, sharePassword });
    expectWaiting(world);
  },
);

Given(
  'agent {word} waits for user {int} to approve the add of {string} to {string}',
  async (world: SynoikiaWorld, agent: string, _user: number, title: string, list: string) => {
    await world.call(agent, 'add a task', { list, title });
    expectWaiting(world);
  },
);

Given(
  'agent {word} waits for the admin to approve deleting the list {string}',
  async (world: SynoikiaWorld, agent: string, list: string) => {
    await world.call(agent, 'delete a list', { list });
    expectWaiting(world);
  },
);

Given('the plugin of {string} gives no typed confirmation', (world: SynoikiaWorld) => {
  world.pluginFlag('no-confirmation');
});

Given('the admin requires two-factor sign-in for everyone', async (world: SynoikiaWorld) => {
  await world.expectOk(world.admin.put('/api/settings/security', { requireTotp: true }), 'require two-factor');
});

Given(
  'the admin approved an add of agent {word} on the approval page, and keeps the browser open',
  async (world: SynoikiaWorld, agent: string) => {
    await world.call(agent, 'add a task', { list: 'Groceries', title: 'butter' });
    expectWaiting(world);
    const s = await openSignedIn(world, 'admin');
    const done = await s.browser!.send(s.pagePath!, { csrf: csrfOf(s.opened!.html), decision: 'approve' });
    expect(done.html).toContain('was approved');
  },
);

Given('the idle limit of the approval page is {int} hours', async (world: SynoikiaWorld, hours: number) => {
  await world.expectOk(
    world.admin.put('/api/settings/security', { approvalSessionIdleHours: hours }),
    'set the idle limit',
  );
});

Given(
  '{int} hours pass, and agent {word} waits for the admin to approve the add of {string} to {string}',
  async (world: SynoikiaWorld, hours: number, agent: string, title: string, list: string) => {
    await world.advanceClock(hours * 3_600_000);
    await world.call(agent, 'add a task', { list, title });
    expectWaiting(world);
  },
);

Given('the access gateway signs people in for core', async (world: SynoikiaWorld) => {
  await world.accessGateway();
});

Given('the admin turns the gateway off for {string}', async (world: SynoikiaWorld, slug: string) => {
  const id = await world.tasksInstance(slug);
  await world.expectOk(
    world.admin.patch(`/api/instances/${id}`, { authMethods: ['bearer', 'oauth'] }),
    'narrow the sign-in methods',
  );
});

Given('the admin turns the gateway off for every instance', async (world: SynoikiaWorld) => {
  await world.expectOk(
    world.admin.put('/api/settings/mcp', { clientAuth: { external: false } }),
    'turn the gateway off',
  );
});

Given('the admin lets people sign up with the role {string}', async (world: SynoikiaWorld, role: string) => {
  const defaultRoleId = await world.role(role);
  await world.expectOk(
    world.admin.put('/api/settings/security', { localSignup: true, defaultRoleId }),
    'allow sign-up',
  );
});

Given(
  'user {int} signs up, and gives agent {word} a credential that may read and write',
  async (world: SynoikiaWorld, user: number, agent: string) => {
    await world.signUp(`user ${user}`);
    await world.credential(agent, `user ${user}`, 'write');
  },
);

Given('user {int} signed in on the approval page', async (world: SynoikiaWorld, user: number) => {
  const s = await openSignedIn(world, `user ${user}`);
  expect(s.opened!.html).toContain(`Signed in as <strong>${world.person(`user ${user}`).username}</strong>`);
});

// ── what happens ──

When('the admin opens the approval link and signs in', async (world: SynoikiaWorld) => {
  await openSignedIn(world, 'admin');
});

When('the admin sends an approval without the form token', async (world: SynoikiaWorld) => {
  const s = await openSignedIn(world, 'admin');
  s.answer = await s.browser!.send(s.pagePath!, { decision: 'approve' });
});

When('the admin approves the add on the approval page', async (world: SynoikiaWorld) => {
  const s = await openSignedIn(world, 'admin');
  s.answer = await s.browser!.send(s.pagePath!, { csrf: csrfOf(s.opened!.html), decision: 'approve' });
});

When(
  'the admin sends an approval with a form token from the page of another approval',
  async (world: SynoikiaWorld) => {
    const first = world.approvalLink();
    await world.call('7', 'add a task', { list: 'Groceries', title: 'jam' });
    expectWaiting(world);
    const s = await openSignedIn(world, 'admin');
    s.pagePath = first;
    s.answer = await s.browser!.send(first, { csrf: csrfOf(s.opened!.html), decision: 'approve' });
  },
);

When(
  'the admin sends an approval with a form token from another browser of the admin',
  async (world: SynoikiaWorld) => {
    const other = await world.approvalPage('admin');
    const s = await openSignedIn(world, 'admin');
    s.answer = await s.browser!.send(s.pagePath!, { csrf: csrfOf(other.html), decision: 'approve' });
  },
);

When(
  'the admin sends an approval with a form token copied from the cookie of the page',
  async (world: SynoikiaWorld) => {
    const s = await openSignedIn(world, 'admin');
    const cookie = s.browser!.jar.get('syn_mcp_csrf');
    expect(cookie).toEqual(expect.any(String));
    s.answer = await s.browser!.send(s.pagePath!, { csrf: cookie!, decision: 'approve' });
  },
);

When('the admin sends an approval with a form token with one character changed', async (world: SynoikiaWorld) => {
  const s = await openSignedIn(world, 'admin');
  const csrf = csrfOf(s.opened!.html);
  const changed = `${csrf.slice(0, -1)}${csrf.endsWith('A') ? 'B' : 'A'}`;
  s.answer = await s.browser!.send(s.pagePath!, { csrf: changed, decision: 'approve' });
});

When('the admin approves the delete with the confirmation {string}', async (world: SynoikiaWorld, confirm: string) => {
  const s = await openSignedIn(world, 'admin');
  s.answer = await s.browser!.send(s.pagePath!, { csrf: csrfOf(s.opened!.html), decision: 'approve', confirm });
});

When(
  'the admin approves the delete with the confirmation {string} and agent {word} resumes it',
  async (world: SynoikiaWorld, confirm: string, agent: string) => {
    await world.approveAndResume(agent, 'admin', confirm);
  },
);

When('the admin opens the new approval link in the same browser', async (world: SynoikiaWorld) => {
  const s = seenBy(world);
  s.pagePath = world.approvalLink();
  s.opened = await s.browser!.send(s.pagePath);
});

When('user {int} approves the add through the access gateway', async (world: SynoikiaWorld, user: number) => {
  const assertion = await world.gatewayAssertion(await userIdentity(world, user));
  const s = seenBy(world);
  s.browser = world.pageBrowser({ 'cf-access-jwt-assertion': assertion });
  s.pagePath = world.approvalLink();
  s.gatewayPage = await s.browser.send(s.pagePath);
  s.answer = await s.browser.send(s.pagePath, { csrf: csrfOf(s.gatewayPage.html), decision: 'approve' });
  expect(s.answer.html).toContain('was approved');
});

When(
  'the access gateway sends the approval link with the identity of user {int}',
  async (world: SynoikiaWorld, user: number) => {
    await throughGateway(world, await userIdentity(world, user));
  },
);

When(
  'the access gateway sends the approval link with the identity of user {int} to the same browser',
  async (world: SynoikiaWorld, user: number) => {
    await throughGateway(world, await userIdentity(world, user), seenBy(world).browser);
  },
);

When('the access gateway sends the approval link with a service token', async (world: SynoikiaWorld) => {
  await throughGateway(world, { sub: '', common_name: 'acme-robot.access' });
});

When(
  'the access gateway sends the approval link with the identity {string}',
  async (world: SynoikiaWorld, email: string) => {
    await throughGateway(world, { sub: 'acme-unknown', email });
  },
);

// ── what someone sees ──

Then(
  'the admin sees {string} for {string}, signed in as admin, without {string}',
  (world: SynoikiaWorld, name: string, list: string, secret: string) => {
    const { opened } = seenBy(world);
    expect(opened?.status).toBe(200);
    expect(opened?.html).toContain(opKey(name));
    expect(opened?.html).toContain(`${name}: ${list}`);
    expect(opened?.html).toContain('Signed in as <strong>admin</strong>');
    expect(opened?.html).not.toContain(secret);
  },
);

Then('the call of agent {word} still waits for a decision', async (world: SynoikiaWorld) => {
  expect(await world.audit({ kind: 'call', decision: 'human-approved' })).toEqual([]);
  expect((await world.pageBrowser().send(seenBy(world).pagePath ?? world.approvalLink())).status).toBe(200);
});

Then('the admin is told that the form expired', (world: SynoikiaWorld) => {
  const { answer } = seenBy(world);
  expect(answer?.status).toBe(400);
  expect(answer?.html).toContain('The form expired; try again.');
});

Then(
  'the admin is told that the add was approved, and to return to the chat of agent {word}',
  (world: SynoikiaWorld, agent: string) => {
    const html = seenBy(world).answer?.html;
    expect(html).toContain(`${opKey('add a task')} on /tasks was approved.`);
    expect(html).toContain(`return to your chat (<strong>token:agent ${agent}</strong>)`);
  },
);

Then('the admin is told that the approval request belongs to another user, with no details', (world: SynoikiaWorld) => {
  const { opened } = seenBy(world);
  expect(opened?.status).toBe(403);
  expect(opened?.html).toContain('This approval request belongs to another user.');
  expect(opened?.html).not.toContain(opKey('add a task'));
  expect(opened?.html).not.toContain('butter');
});

Then('the admin cannot approve it', async (world: SynoikiaWorld) => {
  const s = seenBy(world);
  const answer = await s.browser!.send(s.pagePath!, { csrf: 'x', decision: 'approve' });
  expect(answer.status).toBe(403);
  expect(await world.audit({ kind: 'call', decision: 'human-approved' })).toEqual([]);
});

Then('the admin is told to type {string} exactly to approve', (world: SynoikiaWorld, literal: string) => {
  const { answer } = seenBy(world);
  expect(answer?.status).toBe(400);
  expect(answer?.html).toContain(`Type &quot;${literal}&quot; exactly to approve`);
});

Then('the admin can still deny the delete on the same page', async (world: SynoikiaWorld) => {
  const s = seenBy(world);
  const denied = await s.browser!.send(s.pagePath!, { csrf: csrfOf(s.opened!.html), decision: 'deny' });
  expect(denied.html).toContain(`${opKey('delete a list')} on /tasks was denied.`);
});

Then(
  'agent {word} is told that the plugin gave no confirmation for {string}',
  (world: SynoikiaWorld, _agent: string, name: string) => {
    expect(world.answer).toEqual({
      error: 'PLUGIN_ERROR',
      message: `The plugin did not provide a confirmation value for ${opKey(name)}`,
    });
  },
);

Then(
  'the audit log shows that the admin approved the add of {string} after a sign-in on the page',
  async (world: SynoikiaWorld, title: string) => {
    const [row] = (await addsOf(world, title)).filter((r) => r.decision === 'human-approved');
    expect(row).toMatchObject({ decidedBy: 'admin', detail: { approverSignIn: 'session' } });
  },
);

Then('the admin is told that core requires two-factor authentication', (world: SynoikiaWorld) => {
  const { answer } = seenBy(world);
  expect(answer?.status).toBe(403);
  expect(answer?.html).toContain('This server requires two-factor authentication.');
});

Then('the approval link still asks the admin to sign in', (world: SynoikiaWorld) => {
  expect(seenBy(world).opened?.html).toContain('Sign in to review this approval request.');
});

Then('the admin sees the add, signed in as admin', (world: SynoikiaWorld) => {
  const { opened } = seenBy(world);
  expect(opened?.status).toBe(200);
  expect(opened?.html).toContain('add a task: &quot;jam&quot; in Groceries');
  expect(opened?.html).toContain('Signed in as <strong>admin</strong>');
});

Then('the admin is asked to sign in again', (world: SynoikiaWorld) => {
  expect(seenBy(world).opened?.html).toContain('Sign in to review this approval request.');
});

Then('the page showed that the access gateway signed in user {int}', (world: SynoikiaWorld, user: number) => {
  const { username } = world.person(`user ${user}`);
  expect(seenBy(world).gatewayPage?.html).toContain(`Signed in as <strong>${username}</strong> via Cloudflare Access`);
});

Then('Acme receives the add of {string}', async (world: SynoikiaWorld, title: string) => {
  await eventually(() => world.lists.get('Groceries')!.some((t) => t.title === title), `the add of ${title} at Acme`);
});

Then(
  'the audit log shows that user {int} approved the add of {string} after a sign-in by the gateway',
  async (world: SynoikiaWorld, user: number, title: string) => {
    let rows: CallRow[] = [];
    await eventually(
      async () => (rows = (await addsOf(world, title)).filter((r) => r.decision === 'human-approved')).length > 0,
      'the audit of the add',
    );
    expect(rows[0]).toMatchObject({
      decidedBy: world.person(`user ${user}`).username,
      detail: { approverSignIn: 'external' },
    });
  },
);

Then('the browser gets the page that the approval request belongs to another user', (world: SynoikiaWorld) => {
  const page = seenBy(world).gatewayPage;
  expect(page?.status).toBe(403);
  expect(page?.html).toContain('This approval request belongs to another user.');
});

Then('the browser gets the sign-in form', (world: SynoikiaWorld) => {
  const page = seenBy(world).gatewayPage;
  expect(page?.status).toBe(200);
  expect(page?.html).toContain('Sign in to review this approval request.');
});

Then(
  'the browser gets the sign-in form, and core made no account for {string}',
  async (world: SynoikiaWorld, email: string) => {
    expect(seenBy(world).gatewayPage?.html).toContain('Sign in to review this approval request.');
    const users = (await world.expectOk(world.admin.get('/api/users'), 'list users')) as unknown as {
      username: string;
    }[];
    expect(users.map((u) => u.username.toLowerCase())).not.toContain(email.toLowerCase());
  },
);

Then(
  'the browser gets the approval page, signed in as user {int} on the page itself',
  (world: SynoikiaWorld, user: number) => {
    const page = seenBy(world).gatewayPage;
    expect(page?.status).toBe(200);
    expect(page?.html).toContain(`Signed in as <strong>${world.person(`user ${user}`).username}</strong> ·`);
  },
);

Then('the page ran no script before the decision', (world: SynoikiaWorld) => {
  const { opened } = seenBy(world);
  expect(opened?.html).not.toMatch(/<script\b/);
  expect(opened?.csp).toContain("default-src 'none'");
  expect(opened?.csp).not.toContain('script-src');
});

Then('the page after the decision runs only the script that closes the tab', (world: SynoikiaWorld) => {
  const { answer } = seenBy(world);
  const scripts = [...answer!.html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  expect(scripts).toHaveLength(1);
  expect(scripts[0]).toMatch(/window\.close\(\)/);
  expect(answer?.csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
});
