import type { Context, Hono } from 'hono';
import type { AppContext } from '../../app.js';
import { grantOptions } from '../../approvals/grants.js';
import { mayDecide as ownerMayDecide } from '../../approvals/service.js';
import type { ApproverSignIn } from '../../approvals/service.js';
import { externalProvider } from '../../auth/external.js';
import type { UserRow } from '../../auth/users.js';
import { ServiceError } from '../../errors.js';
import { effectiveAuthMethods } from '../../instances/manager.js';
import { getSettings } from '../../settings.js';
import { sha256 } from '../../auth/tokens.js';
import { clientIp } from '../common.js';
import { boundCsrf, checkBoundCsrf, renderLogin, uiSession } from './oauth-routes.js';
import { approvalPage, decidedPage, errorPage } from './pages.js';

/** The approval page (design §5.3): deciding needs the call's owner, signed in on this page or named by the
 * endpoint's external provider, and a CSRF-protected POST, so neither the link holder nor a prefetch decides. */
export function registerApprovalRoutes(app: Hono, ctx: AppContext) {
  const gone = (c: Context) =>
    errorPage(c, 'Link expired', 'This approval request has expired or was already decided.', 404);

  const load = (c: Context, token: string) => {
    const link = ctx.links.resolve(token);
    if (!link) {
      // Tokens are unguessable; this only slows down noisy scanners.
      ctx.throttle.allowIp(clientIp(c, ctx.config.TRUST_PROXY));
      return null;
    }
    const row = ctx.approvals.withDetails(link.approvalId);
    return row ? { link, ...row } : null;
  };
  type Loaded = NonNullable<ReturnType<typeof load>>;
  interface Approver {
    user: UserRow;
    signIn: ApproverSignIn;
    /** The external provider's name, shown on the page. */
    via?: string;
  }

  /** Locked and typed-confirmation operations never get a session grant. */
  const grantsFor = (data: Loaded) =>
    data.op.locked || data.approval.confirmLiteral
      ? []
      : grantOptions(ctx.now(), ctx.instances.settingsOf(data.instance).sessionGrantMaxHours);

  /** A page sign-in wins; else, on an endpoint that allows `external`, the provider names an existing,
   * enabled user (no self-registration here). The provider checks every request, so no session is kept. */
  const approver = async (c: Context, data: Loaded): Promise<Approver | null> => {
    const session = uiSession(ctx, c, 'approval');
    if (session) return { user: session.user, signIn: 'session' };
    if (!effectiveAuthMethods(ctx.db, data.instance.authMethods).includes('external')) return null;
    const settings = getSettings(ctx.db, 'mcp');
    const provider = externalProvider(settings);
    if (!provider.configured(settings)) return null;
    const found = await provider.identify(c.req.raw.headers, settings, ctx.externalKeys);
    if (!found.ok) {
      ctx.log.debug('Approval page: external provider did not identify the browser', { reason: found.reason });
      return null;
    }
    const user = ctx.users.byExternalIdentity(found.identity);
    if (!user || user.disabled) {
      ctx.log.info('Approval page: no enabled user matches the external identity', { provider: provider.id });
      return null;
    }
    return { user, signIn: 'external', via: provider.name };
  };

  /** The form's CSRF field fits only this approval link and this approver. */
  const formBinding = (token: string, who: Approver) => ({ a: sha256(token), u: who.user.id });

  const mayDecide = (who: Approver, data: Loaded) =>
    ownerMayDecide(data.approval, who.user.id, ctx.users.isAdmin(who.user));

  const notYours = (c: Context) =>
    errorPage(
      c,
      'Not your request',
      'This approval request belongs to another user. Only the person whose client made the call can decide.',
      403,
    );

  const render = (c: Context, token: string, data: Loaded, who: Approver, error?: string) =>
    approvalPage(
      c,
      {
        token,
        csrf: boundCsrf(ctx, c, formBinding(token, who), data.approval.expiresAt.getTime() - ctx.now().getTime()),
        username: who.user.username,
        via: who.via,
        slug: data.instance.slug,
        instanceName: data.instance.displayName,
        operationKey: data.op.key,
        locked: data.op.locked,
        summary: data.approval.summary,
        params: data.approval.paramsDisplay,
        targets: data.approval.resolvedTargets,
        diff: data.approval.diff,
        expiresAt: data.approval.expiresAt,
        confirmLiteral: data.approval.confirmLiteral,
        grantOptions: grantsFor(data).map(({ value, label }) => ({ value, label })),
        client: data.approval.clientId,
        status: data.approval.status,
        error,
      },
      error ? 400 : 200,
    );

  app.get('/a/:token', async (c) => {
    const token = c.req.param('token');
    const data = load(c, token);
    if (!data) return gone(c);
    const who = await approver(c, data);
    if (!who) return renderLogin(ctx, c, `/a/${token}`, 'Sign in to review this approval request.');
    if (!mayDecide(who, data)) return notYours(c);
    return render(c, token, data, who);
  });

  app.post('/a/:token', async (c) => {
    const token = c.req.param('token');
    const body = await c.req.parseBody();
    const data = load(c, token);
    if (!data) return gone(c);
    const who = await approver(c, data);
    if (!who) return renderLogin(ctx, c, `/a/${token}`, 'Your sign-in expired. Sign in again to decide.');
    if (!mayDecide(who, data)) return notYours(c);
    if (!checkBoundCsrf(ctx, c, body.csrf, formBinding(token, who)))
      return render(c, token, data, who, 'The form expired; try again.');
    const approve = body.decision === 'approve' || body.decision === 'approve_session';
    if (!approve && body.decision !== 'deny') return render(c, token, data, who, 'Choose approve or deny.');
    let sessionGrantUntil: Date | undefined;
    if (body.decision === 'approve_session') {
      sessionGrantUntil = grantsFor(data).find((o) => o.value === body.grant)?.until;
      if (!sessionGrantUntil) return render(c, token, data, who, 'Choose a session length.');
    }

    try {
      ctx.approvals.decide(data.approval.id, {
        approve,
        confirm: typeof body.confirm === 'string' ? body.confirm : undefined,
        decidedBy: who.user.username,
        decidedById: who.user.id,
        signIn: who.signIn,
        sessionGrantUntil,
      });
    } catch (err) {
      if (err instanceof ServiceError) return render(c, token, data, who, err.message);
      throw err;
    }
    const granted = sessionGrantUntil
      ? ` Ask operations of this client on /${data.instance.slug} run without asking until ${sessionGrantUntil.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
      : '';
    return decidedPage(
      c,
      approve ? 'Approved' : 'Denied',
      `${data.op.key} on /${data.instance.slug} was ${approve ? 'approved' : 'denied'}.${granted} Your chat continues by itself.`,
      data.approval.clientId,
    );
  });
}
