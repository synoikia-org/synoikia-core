import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Grant, Notifier, PublicUser, RoleRow, Settings, Token } from '../src/types';
import { adminRole, fakeApi, json, mcpSettings, mountAt, signedIn } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const operators = { ...adminRole, id: 'r1', name: 'Operators', isAdmin: false };
const roles: RoleRow[] = [
  { ...adminRole, users: 1, endpoints: [], isDefault: false },
  { ...operators, users: 0, endpoints: [], isDefault: false },
];
const overview = { instances: [], plugins: [], warnings: [], publicMcpUrl: null };
const me: PublicUser = { ...signedIn.user, createdAt: '2026-01-01T00:00:00Z', lastLoginAt: null };
const settings: Settings = {
  security: {
    requireTotp: false,
    disableLocalLogin: false,
    sessionIdleMinutes: 60,
    approvalSessionIdleHours: 12,
    approvalSessionAbsoluteDays: 7,
    sessionAbsoluteHours: 24,
    defaultRoleId: null,
    localSignup: false,
  },
  mcp: mcpSettings,
  audit: { retentionDays: null },
  oidc: null,
  forceLocalLogin: false,
  publicMcpUrl: null,
  publicAdminUrl: null,
};

const button = (text: string, root: ParentNode = document.body) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const dialogTitle = () => document.getElementById(dialog()?.getAttribute('aria-labelledby') ?? '')?.textContent;
const writes = <C extends { method: string }>(calls: C[]) => calls.filter((c) => c.method !== 'GET');

async function click(text: string, root?: ParentNode) {
  button(text, root)!.click();
  await flushPromises();
}

describe('the Roles page', () => {
  const api = () =>
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/roles': roles,
      'PATCH /api/roles/r1': { ok: true },
      'DELETE /api/roles/r1': { ok: true },
    });

  it('deletes a role only after the dialog confirms it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { calls } = api();
    await mountAt('/settings/roles');
    await click('Delete');
    expect(dialogTitle()).toBe('Delete the role Operators?');
    await click('Cancel', dialog()!);
    expect(dialog()).toBeNull();
    expect(writes(calls)).toHaveLength(0);

    await click('Delete');
    await click('Delete', dialog()!);
    expect(writes(calls)).toEqual([{ method: 'DELETE', path: '/api/roles/r1', body: undefined }]);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('renames a role from the dialog, and sends nothing on cancel or an unchanged name', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const { calls } = api();
    const { body } = await mountAt('/settings/roles');
    await click('Rename');
    expect(dialogTitle()).toBe('Rename Operators');
    expect(body.get<HTMLInputElement>('[role="dialog"] input').element.value).toBe('Operators');
    await click('Cancel', dialog()!);
    await click('Rename');
    await click('Rename', dialog()!);
    expect(writes(calls)).toHaveLength(0);

    await click('Rename');
    await body.get('[role="dialog"] input').setValue('  Ops ');
    await click('Rename', dialog()!);
    expect(writes(calls)).toEqual([{ method: 'PATCH', path: '/api/roles/r1', body: { name: 'Ops' } }]);
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('shows why an action failed', async () => {
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/roles': roles,
      'POST /api/roles': json(409, { error: 'conflict', message: 'A role with that name exists' }),
    });
    const { wrapper } = await mountAt('/settings/roles');
    await wrapper.get('input[aria-label="New role name"]').setValue('Operators');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('A role with that name exists');
  });
});

describe('the User auth settings', () => {
  it('asks for ADMIN before opening self-registration to administrators', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/settings': settings,
      'GET /api/roles': roles,
      'PUT /api/settings/security': (b: unknown) => b,
    });
    const { wrapper, body } = await mountAt('/settings/user-auth');
    await wrapper.get('select#s-role').setValue('admin');
    const registration = wrapper.findAll('form').find((f) => f.text().includes('Self-registration'))!;
    await registration.trigger('submit');
    await flushPromises();
    expect(dialogTitle()).toBe('New accounts will be administrators.');
    expect(dialog()?.textContent).toContain('Type ADMIN to confirm.');
    await body.get('[role="dialog"] input').setValue('admin');
    await click('Save', dialog()!);
    await registration.trigger('submit');
    await flushPromises();
    await click('Cancel', dialog()!);
    expect(writes(calls)).toHaveLength(0);

    await registration.trigger('submit');
    await flushPromises();
    await body.get('[role="dialog"] input').setValue('ADMIN');
    await click('Save', dialog()!);
    expect(writes(calls)).toEqual([
      { method: 'PUT', path: '/api/settings/security', body: { defaultRoleId: 'admin', localSignup: false } },
    ]);
    expect(registration.text()).toContain('Saved.');
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it('saves only the Sign-in fields from the Sign-in card, so an unconfirmed admin role is not sent', async () => {
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/settings': settings,
      'GET /api/roles': roles,
      'PUT /api/settings/security': (b: unknown) => ({ ...settings.security, ...(b as object) }),
    });
    const { wrapper } = await mountAt('/settings/user-auth');
    await wrapper.get('select#s-role').setValue('admin');
    await wrapper.get('input#s-idle').setValue(30);
    const signIn = wrapper.findAll('form').find((f) => f.find('h2').text() === 'Sign-in')!;
    await signIn.trigger('submit');
    await flushPromises();
    expect(dialog()).toBeNull();
    const { defaultRoleId: _role, localSignup: _signup, ...signInFields } = settings.security;
    expect(writes(calls)).toEqual([
      { method: 'PUT', path: '/api/settings/security', body: { ...signInFields, sessionIdleMinutes: 30 } },
    ]);
    expect(signIn.text()).toContain('Saved.');
  });

  it('names the sign-in fields and has no audit retention', async () => {
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/settings': settings,
      'GET /api/roles': roles,
    });
    const { wrapper } = await mountAt('/settings/user-auth');
    expect(document.title).toBe('User auth · Synoikia');
    expect(wrapper.findAll('form h2').map((h) => h.text())).toEqual([
      'Sign-in',
      'Self-registration',
      'Single sign-on (OIDC)',
    ]);
    expect(wrapper.get('label[for="s-abs"]').text()).toBe('Max session authentication duration (hours)');
    expect(wrapper.get('label[for="s-role"]').text()).toBe('Default role of new accounts');
    expect(wrapper.find('#a-ret').exists()).toBe(false);
  });

  it('shows only Enabled until single sign-on is on, keeps typed values, and saves it off', async () => {
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/settings': settings,
      'GET /api/roles': roles,
      'PUT /api/settings/oidc': (b: unknown) => ({ ...(b as object), clientSecretSet: false }),
    });
    const { wrapper } = await mountAt('/settings/user-auth');
    const form = wrapper.findAll('form').find((f) => f.text().includes('Single sign-on (OIDC)'))!;
    const enabled = form.get<HTMLInputElement>('input[type="checkbox"]');
    expect(form.findAll('input').length).toBe(1);
    expect(form.text()).not.toContain('Who may sign in');
    expect(form.find('button[type="submit"]').exists()).toBe(true);

    await enabled.setValue(true);
    expect(form.text()).toContain('Who may sign in');
    expect(form.get('#o-emails-help').text()).toContain('*@example.com');
    expect(form.text()).toContain('Provision an account on first sign-in for anyone the policy allows');
    await form.get('#o-iss').setValue('https://idp.example.com/');
    await wrapper.get('input#s-idle').setValue('90');
    await enabled.setValue(false);
    expect(form.find('#o-iss').exists()).toBe(false);
    await enabled.setValue(true);
    expect(form.get<HTMLInputElement>('#o-iss').element.value).toBe('https://idp.example.com/');

    await enabled.setValue(false);
    await form.trigger('submit');
    await flushPromises();
    expect(writes(calls)).toEqual([
      {
        method: 'PUT',
        path: '/api/settings/oidc',
        body: expect.objectContaining({ enabled: false, issuer: 'https://idp.example.com/' }),
      },
    ]);
    expect(form.text()).toContain('Saved.');
    // Another card's draft survives the save.
    expect(wrapper.get<HTMLInputElement>('input#s-idle').element.value).toBe('90');
  });

  it('sends the old security address to User auth', async () => {
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/settings': settings,
      'GET /api/roles': roles,
    });
    const { router } = await mountAt('/settings/security');
    expect(router.currentRoute.value.path).toBe('/settings/user-auth');
  });
});

describe('the Server settings', () => {
  it('saves the audit log retention, or shows why it failed', async () => {
    let fail = true;
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/settings': settings,
      'PUT /api/settings/audit': () =>
        fail ? json(400, { error: 'invalid', message: 'Too short' }) : { retentionDays: 30 },
    });
    const { wrapper } = await mountAt('/settings/server');
    expect(document.title).toBe('Server settings · Synoikia');
    expect(wrapper.get('#a-ret-help').text()).toContain('The default is 90 days.');
    await wrapper.get('input#a-ret').setValue('30');
    const form = wrapper.get('form');
    await form.trigger('submit');
    await flushPromises();
    expect(form.get('[role="alert"]').text()).toBe('Too short');
    fail = false;
    await form.trigger('submit');
    await flushPromises();
    expect(writes(calls).at(-1)).toEqual({ method: 'PUT', path: '/api/settings/audit', body: { retentionDays: 30 } });
    expect(form.get('[role="status"]').text()).toBe('Saved.');
  });
});

describe('the Client auth settings', () => {
  it('saves and shows core’s answer, or why it failed', async () => {
    let fail = true;
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/settings': settings,
      'PUT /api/settings/mcp': (b: unknown) =>
        fail
          ? json(400, {
              error: 'invalid_settings',
              message: 'Invalid settings',
              details: ['external: configure Cloudflare Access before you enable external auth'],
            })
          : { ...(b as object), refreshTokenTtlDays: 7 },
    });
    const { wrapper } = await mountAt('/settings/client-auth');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('.alert.error').text()).toBe(
      'Invalid settings: external: configure Cloudflare Access before you enable external auth',
    );
    fail = false;
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('.alert.ok').text()).toBe('Saved.');
    expect(wrapper.get<HTMLInputElement>('input#m-rt').element.value).toBe('7');
    const body = writes(calls).at(-1)!.body as Record<string, unknown>;
    expect(body.clientAuth).toEqual({ bearer: true, oauth: true, external: false });
    expect(body).not.toHaveProperty('defaultAuthMode');
    expect(body).not.toHaveProperty('trustedIdentityHeader');
  });

  it('enables External with Cloudflare Access, and saves the provider and its application', async () => {
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/settings': settings,
      'PUT /api/settings/mcp': (b: unknown) => b,
    });
    const { wrapper } = await mountAt('/settings/client-auth');
    const methods = () => wrapper.get('fieldset.methods');
    const box = (label: string) =>
      methods()
        .findAll('label')
        .find((l) => l.text() === label)!
        .get('input');
    expect(wrapper.find('#m-provider').exists()).toBe(false);
    expect(wrapper.find('[data-explain="cf-access"]').exists()).toBe(false);
    await box('External').setValue(true);
    expect(wrapper.get('#m-provider').text()).toBe('Cloudflare Access');
    expect(wrapper.get('[data-warn="external-approvals"]').text()).toContain('could open the approval link itself');
    await wrapper.get('#m-cft').setValue('team.cloudflareaccess.com');
    await wrapper.get('#m-cfa').setValue('aud-tag');
    await box('OAuth').setValue(false);
    expect(wrapper.findAll('section.card h2').map((h) => h.text())).not.toContain('OAuth');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(writes(calls)[0]!.body).toMatchObject({
      clientAuth: { bearer: true, oauth: false, external: true },
      external: { provider: 'cloudflare' },
      cfAccess: { teamDomain: 'team.cloudflareaccess.com', aud: 'aud-tag' },
    });
  });

  it('will not save with no method enabled', async () => {
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/settings': settings,
    });
    const { wrapper } = await mountAt('/settings/client-auth');
    const boxes = wrapper.findAll<HTMLInputElement>('fieldset.methods input[type="checkbox"]');
    for (const b of boxes) await b.setValue(false);
    expect(wrapper.get('[data-warn="no-method"]').text()).toContain('Enable at least one method');
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(true);
    expect(writes(calls)).toEqual([]);
  });

  it('sends the old MCP access address to Client auth', async () => {
    fakeApi({ 'GET /api/session': signedIn, 'GET /api/overview': overview, 'GET /api/settings': settings });
    const { router } = await mountAt('/settings/mcp');
    expect(router.currentRoute.value.path).toBe('/settings/client-auth');
  });
});

describe('the Notifications page', () => {
  const channel: Notifier = {
    id: 'n1',
    kind: 'ntfy',
    name: 'Phone',
    config: { server: 'https://ntfy.example', topic: 't' },
    secrets: {},
    events: ['instance.error'],
    instanceFilter: null,
    enabled: true,
    lastSentAt: null,
    lastError: null,
  };

  it('deletes a channel only after the dialog confirms it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { calls } = fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/notifiers': [channel],
      'DELETE /api/notifiers/n1': { ok: true },
    });
    await mountAt('/settings/notifications');
    await click('Delete');
    expect(dialogTitle()).toBe('Delete Phone?');
    await click('Cancel', dialog()!);
    expect(writes(calls)).toHaveLength(0);

    await click('Delete');
    await click('Delete', dialog()!);
    expect(writes(calls)).toEqual([{ method: 'DELETE', path: '/api/notifiers/n1', body: undefined }]);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('reports a failed test send', async () => {
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/notifiers': [channel],
      'POST /api/notifiers/n1/test': { ok: false, error: 'timeout' },
    });
    const { wrapper } = await mountAt('/settings/notifications');
    await click('Test');
    expect(wrapper.get('[role="alert"]').text()).toBe('Test to Phone failed: timeout');
  });
});

describe('My profile', () => {
  const token: Token = {
    id: 't1',
    createdBy: 'u1',
    name: 'Laptop',
    scope: ['*'],
    access: 'read',
    createdAt: '2026-01-01T00:00:00Z',
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
  };
  const grant: Grant = {
    id: 'g1',
    resources: ['/nas'],
    access: 'write',
    createdAt: '2026-01-01T00:00:00Z',
    revokedAt: null,
    client: { id: 'c1', clientId: 'cid', name: 'Desk client' },
    user: { id: 'u1', username: 'admin' },
  };
  const profileApi = (extra: Record<string, unknown> = {}) =>
    fakeApi({
      'GET /api/session': signedIn,
      'GET /api/overview': overview,
      'GET /api/profile': me,
      'GET /api/profile/approval-sessions': [],
      'GET /api/me/tokens': [token],
      'GET /api/me/grants': [grant],
      'GET /api/me/endpoints': { assigned: [], unassigned: [] },
      ...extra,
    });

  it('opens at /profile without the settings tabs, and keeps the old address with its query', async () => {
    profileApi({ 'GET /api/profile': { ...me, oidcLinked: true } });
    const { wrapper, router } = await mountAt('/settings/profile?linked=1');
    expect(router.currentRoute.value.fullPath).toBe('/profile?linked=1');
    expect(wrapper.get('h1').text()).toBe('My profile');
    expect(wrapper.find('nav[aria-label="Settings sections"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Single sign-on linked.');
  });

  it('says when an SSO link expired or the session changed', async () => {
    profileApi({ 'GET /api/profile': { ...me, oidcLinked: true } });
    const { wrapper } = await mountAt('/profile?error=session_changed');
    expect(wrapper.text()).toContain('Linking expired or your session changed. Try again.');
  });

  it('revokes a token or a grant only after the dialog confirms it', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const { calls } = profileApi({
      'DELETE /api/me/tokens/t1': { ok: true },
      'DELETE /api/me/grants/g1': { ok: true },
    });
    await mountAt('/profile');
    const revoke = () => [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Revoke');
    revoke()[0]!.click();
    await flushPromises();
    expect(dialogTitle()).toBe('Revoke Laptop?');
    expect(dialog()?.textContent).toContain('Clients using it lose access now.');
    await click('Cancel', dialog()!);
    expect(writes(calls)).toHaveLength(0);

    revoke()[0]!.click();
    await flushPromises();
    await click('Revoke', dialog()!);
    revoke()[1]!.click();
    await flushPromises();
    expect(dialogTitle()).toBe('Revoke Desk client?');
    await click('Revoke', dialog()!);
    expect(writes(calls).map((c) => `${c.method} ${c.path}`)).toEqual([
      'DELETE /api/me/tokens/t1',
      'DELETE /api/me/grants/g1',
    ]);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('keeps the recovery codes on screen after enrollment until the user saved them', async () => {
    let enrolled = false;
    profileApi({
      'GET /api/profile': () => ({ ...me, totpEnabled: enrolled }),
      'POST /api/profile/totp/begin': { secret: 'ABC', uri: 'otpauth://totp/x' },
      'POST /api/profile/totp/confirm': () => {
        enrolled = true;
        return { recoveryCodes: ['r-1', 'r-2'] };
      },
    });
    const { wrapper } = await mountAt('/profile');
    await click('Set up two-factor authentication');
    await wrapper.get('input[aria-label="Code"]').setValue('123456');
    await wrapper.get<HTMLInputElement>('input[aria-label="Code"]').element.form!.requestSubmit();
    await flushPromises();
    expect(wrapper.get('pre.recovery').text()).toContain('r-1');
    await click('I saved them');
    expect(wrapper.text()).toContain('Enter a current code (or a recovery code) to turn it off.');
  });

  it('shows a mismatch before sending a new password, and core’s answer after', async () => {
    const { calls } = profileApi({
      'POST /api/profile/password': json(400, { error: 'weak', message: 'Password too common' }),
    });
    const { wrapper } = await mountAt('/profile');
    await wrapper.get('input#p-new').setValue('correct horse battery');
    await wrapper.get('input#p-conf').setValue('different horse battery');
    const form = wrapper.findAll('form').find((f) => f.text().includes('Change password'))!;
    await form.trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('The new passwords do not match.');
    expect(writes(calls)).toHaveLength(0);
    await wrapper.get('input#p-conf').setValue('correct horse battery');
    await form.trigger('submit');
    await flushPromises();
    expect(wrapper.text()).toContain('Password too common');
  });
});
