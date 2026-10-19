import { randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { csrfOf } from '../../support/world.js';
import type { PageBrowser, PageResponse, SynoikiaWorld } from '../../support/world.js';

/** What the identity steps keep between steps of one scenario. */
export interface IdentityState {
  /** What the last sign-in or portal change answered, as text the person reads. */
  answer: { status: number; text: string; body: Record<string, unknown> };
  /** Each person's browsers by name, such as "user 12" or "user 12 #2". */
  browsers: Map<string, Portal>;
  /** Each person's authenticator app: its secret, the code it was confirmed with and the recovery codes. */
  apps: Map<string, { secret: string; enrollCode: string; recoveryCodes: string[]; uri: string }>;
  /** The recovery codes that the last request for new ones gave. */
  newCodes?: string[];
  /** The address core sees for the people who sign in, when a scenario sets one. */
  address?: string;
  /** The last code given, and the browser on the consent page with its last page. */
  lastCode?: string;
  consent?: { browser: PageBrowser; path: string; page?: PageResponse };
  approval?: { browser: PageBrowser; path: string };
  /** The OAuth client "Acme Chat" and the inbox of notifications, when a scenario makes them. */
  clientId?: string;
  inbox?: { title: string; message: string }[];
}

type Portal = Awaited<ReturnType<SynoikiaWorld['portalBrowser']>>;

const states = new WeakMap<SynoikiaWorld, IdentityState>();
export const identity = (world: SynoikiaWorld) => {
  let s = states.get(world);
  if (!s) states.set(world, (s = { answer: { status: 0, text: '', body: {} }, browsers: new Map(), apps: new Map() }));
  return s;
};

/** A fresh portal browser, from the scenario's address when it has one. */
export const newPortal = (world: SynoikiaWorld) => {
  const { address } = identity(world);
  return world.portalBrowser(address ? { 'x-forwarded-for': address } : {});
};

/** Keeps what a portal request answered for a later Then. */
export async function keep(world: SynoikiaWorld, res: Promise<Response> | Response) {
  const r = await res;
  const text = await r.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* a page, not data */
  }
  identity(world).answer = { status: r.status, text, body };
  return identity(world).answer;
}

export function keepPage(world: SynoikiaWorld, page: PageResponse) {
  identity(world).answer = { status: page.status, text: page.html, body: {} };
  return page;
}

/** `person` gives a name and password in a new portal browser, kept as their browser `name`. */
export async function passwordStep(world: SynoikiaWorld, person: string, password?: string, name = person) {
  const browser = await newPortal(world);
  identity(world).browsers.set(name, browser);
  const who = world.people.get(person);
  await keep(
    world,
    browser.post('/auth/login', { username: who?.username ?? person, password: password ?? who!.password }),
  );
  return browser;
}

export async function codeStep(world: SynoikiaWorld, person: string, code: string, name = person) {
  identity(world).lastCode = code;
  await keep(world, identity(world).browsers.get(name)!.post('/auth/totp', { code }));
}

/** `person` sets up an authenticator app in their portal session and confirms it with the code `steps` periods
 * from now: the code before the current one by default, so the current code still signs in. */
export async function enroll(world: SynoikiaWorld, person: string, steps = -1) {
  const portal = world.person(person).portal!;
  const begun = await world.expectOk(portal.post('/api/profile/totp/begin'), 'start two-factor setup');
  const secret = begun.secret as string;
  const enrollCode = world.totpCode(secret, steps);
  const confirmed = await world.expectOk(
    portal.post('/api/profile/totp/confirm', { code: enrollCode }),
    'confirm two-factor setup',
  );
  const app = { secret, enrollCode, uri: begun.uri as string, recoveryCodes: confirmed.recoveryCodes as string[] };
  identity(world).apps.set(person, app);
  return app;
}

export const appOf = (world: SynoikiaWorld, person: string) => {
  const app = identity(world).apps.get(person);
  if (!app) throw new Error(`${person} has no authenticator app`);
  return app;
};

/** A code the app of `person` would never show now. */
export const wrongCode = (world: SynoikiaWorld, person: string) => {
  const valid = new Set([-1, 0, 1].map((s) => world.totpCode(appOf(world, person).secret, s)));
  for (let n = 123456; ; n++) if (!valid.has(String(n))) return String(n);
};

/** The consent page of the OAuth client "Acme Chat", for the instance "tasks", in a fresh browser. */
export async function consentPage(world: SynoikiaWorld) {
  const s = identity(world);
  await world.publicMcpAddress();
  await world.tasksInstance('tasks');
  if (!s.clientId) {
    const client = await world.expectOk(
      world.admin.post('/api/oauth/clients', { name: 'Acme Chat', redirectUris: ['http://127.0.0.1:9/callback'] }),
      'register client',
    );
    s.clientId = client.client_id as string;
  }
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: s.clientId,
    redirect_uri: 'http://127.0.0.1:9/callback',
    code_challenge: randomBytes(32).toString('base64url').slice(0, 43),
    code_challenge_method: 'S256',
    state: 'acme-chat',
  });
  const path = `/oauth/authorize?${q.toString()}`;
  const browser = world.pageBrowser(s.address ? { 'x-forwarded-for': s.address } : {});
  s.consent = { browser, path, page: await browser.send(path) };
  return s.consent;
}

/** `person` gives a name and password on the sign-in form of the consent page, in its browser. */
export async function consentSignIn(world: SynoikiaWorld, person: string, password?: string) {
  const s = identity(world);
  const consent = s.consent ?? (await consentPage(world));
  const who = world.people.get(person);
  const form = consent.page?.html.includes('name="csrf"') ? consent.page : await consent.browser.send(consent.path);
  consent.page = keepPage(
    world,
    await consent.browser.send('/oauth/login', {
      csrf: csrfOf(form.html),
      continue: consent.path,
      username: who?.username ?? person,
      password: password ?? who!.password,
    }),
  );
  return consent.page;
}

/** `person` gives a code on the code step of the consent page. */
export async function consentCode(world: SynoikiaWorld, code: string) {
  const consent = identity(world).consent!;
  const html = consent.page!.html;
  consent.page = keepPage(
    world,
    await consent.browser.send('/oauth/login/totp', {
      csrf: csrfOf(html),
      mfa: /name="mfa" value="([^"]+)"/.exec(html)?.[1] ?? '',
      continue: consent.path,
      code,
    }),
  );
}

/** An approval that waits for the admin: agent "helper" of the admin adds "butter" to "Groceries" at level ask. */
export async function approvalLink(world: SynoikiaWorld) {
  if (!world.lists.has('Groceries'))
    world.lists.set(
      'Groceries',
      ['milk', 'bread', 'eggs'].map((title) => ({ title, done: false })),
    );
  await world.tasksInstance('tasks');
  await world.setGroupLevel('tasks', 'tasks', 'ask');
  await world.credential('helper', 'admin', 'write');
  await world.call('helper', 'add a task', { list: 'Groceries', title: 'butter' });
  expect(world.answer.status).toBe('awaiting_approval');
  return world.approvalLink();
}

/** `person` opens an approval link in a fresh browser and signs in there: an approval browser. */
export async function approvalBrowser(world: SynoikiaWorld, person: string) {
  const path = await approvalLink(world);
  const browser = world.pageBrowser();
  const signIn = await world.signInOnPage(browser.send, person, path);
  const mfa = /name="mfa" value="([^"]+)"/.exec(signIn.html)?.[1];
  if (mfa) {
    const code = world.totpCode(appOf(world, person).secret);
    await browser.send('/oauth/login/totp', { csrf: csrfOf(signIn.html), mfa, continue: path, code });
  }
  identity(world).approval = { browser, path };
  const page = await browser.send(path);
  expect(page.html).not.toContain('Sign in to review this approval request.');
  return identity(world).approval!;
}

/** Whether a page is the sign-in form of the approval page. */
export const asksToSignIn = (page: PageResponse) => page.html.includes('Sign in to review this approval request.');
