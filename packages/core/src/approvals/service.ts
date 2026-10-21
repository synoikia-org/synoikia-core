import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { writeAudit } from '../audit.js';
import type { Db } from '../db/index.js';
import { operations, pendingApprovals, pluginInstances } from '../db/schema.js';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../errors.js';
import { readInstanceSettings } from '../instances/settings.js';
import type { ApprovalLinkService } from './links.js';

/** Human approval (ADR-0006): an opted-in, non-locked call is decided in the agent session (form prompt,
 * or the card on a parked call); else URL mode sends a human to our page, else the execution parks with the
 * page link (ADR-0006). Any timeout is denied. A client's answer never approves a locked call. */

export type DecisionOutcome = 'approved' | 'denied' | 'timed_out' | 'cancelled';
export type DecisionChannel = 'elicitation' | 'url';
/** Where the decision was offered: `card` is the approval card's buttons (ADR-0006). */
export type ApprovalChannel = 'form' | 'url' | 'link' | 'card';
/** How the approval page knew the approver (ADR-0006). */
export type ApproverSignIn = 'session' | 'external';

interface DecisionBase {
  outcome: DecisionOutcome;
  via?: DecisionChannel;
  channel?: ApprovalChannel;
  decidedBy?: string;
  /** The approver's user id, for decisions on the approval page. */
  decidedById?: string;
  /** Set for decisions on the approval page. */
  signIn?: ApproverSignIn;
  reason?: string;
}

/** An approval that also grants this client the endpoint's Ask operations until `sessionGrantUntil` (ADR-0006). It
 * names its approver, so the grant ends with that user. */
interface GrantingDecision extends DecisionBase {
  decidedBy: string;
  decidedById: string;
  sessionGrantUntil: Date;
}

export type Decision = (DecisionBase & { sessionGrantUntil?: undefined }) | GrantingDecision;

/** The approval page's input: a session grant needs the approver's user id. */
export type PageDecisionInput = {
  approve: boolean;
  confirm?: string;
  decidedBy: string;
  signIn?: ApproverSignIn;
} & ({ decidedById?: string; sessionGrantUntil?: undefined } | { decidedById: string; sessionGrantUntil?: Date });

export interface UrlPromptRequest {
  approvalId: string;
  /** Path of the approval page on the MCP listener; the MCP layer makes it absolute. */
  path: string;
  message: string;
}

export interface UrlPromptResponse {
  action: 'accept' | 'decline' | 'cancel';
}

/** The form has no fields: Accept approves, Decline and Cancel deny. */
export interface FormPromptRequest {
  approvalId: string;
  message: string;
  requestedSchema: { type: 'object'; properties: Record<string, never> };
}

export interface FormPromptResponse {
  action: 'accept' | 'decline' | 'cancel';
}

/** How long a form prompt waits for an answer before its call parks, below a client's usual 60 s tool timeout. */
export const FORM_FALLBACK_MS = 30_000;

/** What the connected MCP client can show; present only for a live session that advertised it. */
export interface ClientPrompts {
  url?: (req: UrlPromptRequest) => Promise<UrlPromptResponse>;
  /** Tells the client a URL prompt was decided, so it can close it. */
  urlComplete?: (approvalId: string) => void;
  /** `signal` aborts when the call parks instead (ADR-0006). */
  form?: (req: FormPromptRequest, signal: AbortSignal) => Promise<FormPromptResponse>;
}

/** A parked approval as the execution hands it to the agent: the page link replaces the client prompt. */
export interface ParkedApproval {
  approvalId: string;
  /** Path of the approval page on the MCP listener; the MCP layer makes it absolute. */
  path: string;
  operationKey: string;
  summary: string;
  expiresAt: Date;
  /** The approval card may decide it in the agent session (ADR-0006). */
  inSession: boolean;
}

/** Lets an execution park (ADR-0006) when the client has no usable prompt, or a form gets no answer. */
export interface ParkHook {
  /** Null when the execution may park; otherwise the denial reason. */
  reserve(): string | null;
  offer(approval: ParkedApproval, info?: { formFallback: true }): void;
}

export interface ApprovalRequestInput {
  instanceId: string;
  operationId: string;
  operationKey: string;
  classification: string;
  paramsDisplay: unknown;
  paramsHash: string;
  resolvedTargets: unknown;
  summary: string;
  confirmLiteral?: string;
  diff?: unknown;
  expectedHash?: string;
  client: { kind: string; id?: string };
  /** The user who owns the calling credential; only they decide on the approval page (ADR-0006). */
  ownerUserId?: string;
  mcpSessionId?: string;
  timeoutMs: number;
  prompts?: ClientPrompts;
  /** The endpoint allows in-session approval, and the operation is not locked and needs no typed confirmation. */
  formApprovals: boolean;
  /** Present when the execution can park; used when no client prompt applies or a form gets no answer. */
  park?: ParkHook;
}

/** Only the credential's owner decides (ADR-0006); a call without one, only an admin. */
export const mayDecide = (approval: { ownerUserId: string | null }, userId: string, isAdmin: boolean) =>
  approval.ownerUserId ? approval.ownerUserId === userId : isAdmin;

interface Live {
  row: typeof pendingApprovals.$inferSelect;
  formApprovals: boolean;
  settle: (d: Decision) => void;
}

export class ApprovalService {
  private readonly live = new Map<string, Live>();

  constructor(
    private readonly db: Db,
    private readonly links: ApprovalLinkService,
    private readonly now: () => Date = () => new Date(),
    private readonly formFallbackMs = FORM_FALLBACK_MS,
  ) {}

  /** At startup, deny and audit pending rows from a previous process: their params lived only in memory (ADR-0006). */
  static denyOrphans(db: Db, now = new Date()): number {
    return db.transaction((tx) => {
      const orphans = tx.select().from(pendingApprovals).where(eq(pendingApprovals.status, 'pending')).all();
      for (const o of orphans) {
        tx.update(pendingApprovals)
          .set({ status: 'denied', decidedAt: now })
          .where(eq(pendingApprovals.id, o.id))
          .run();
        writeAudit(
          tx,
          {
            kind: 'call',
            instanceId: o.instanceId,
            decision: 'denied',
            actorKind: 'system',
            detail: { approvalId: o.id, reason: 'server_restart' },
          },
          now,
        );
      }
      return orphans.length;
    });
  }

  request(input: ApprovalRequestInput): { id: string; decision: Promise<Decision> } {
    const now = this.now();
    const id = randomUUID();
    const row = {
      id,
      instanceId: input.instanceId,
      operationId: input.operationId,
      paramsDisplay: input.paramsDisplay ?? null,
      paramsHash: input.paramsHash,
      resolvedTargets: input.resolvedTargets ?? null,
      summary: input.summary,
      confirmLiteral: input.confirmLiteral ?? null,
      diff: input.diff ?? null,
      expectedHash: input.expectedHash ?? null,
      clientKind: input.client.kind,
      clientId: input.client.id ?? null,
      ownerUserId: input.ownerUserId ?? null,
      mcpSessionId: input.mcpSessionId ?? null,
      requestedAt: now,
      expiresAt: new Date(now.getTime() + input.timeoutMs),
      status: 'pending' as const,
      decidedBy: null,
      decidedVia: null,
      decidedAt: null,
    };

    const prompts = input.prompts ?? {};
    // In the session first (ADR-0006): the form prompt, then the card on a parked call; the page otherwise.
    let channel: 'url' | 'form' | 'link' | null =
      prompts.form && input.formApprovals ? 'form' : prompts.url ? 'url' : null;
    let parkRefused: string | null = null;
    if (!channel && input.park) {
      parkRefused = input.park.reserve();
      if (!parkRefused) channel = 'link';
    }
    if (!channel) {
      // A form-only client can't carry a human's approval for this call; no prompts at all is worse.
      const reason = parkRefused ?? (prompts.form ? 'client_cannot_approve' : 'no_approval_path');
      this.db
        .insert(pendingApprovals)
        .values({ ...row, status: 'denied', decidedAt: now })
        .run();
      return { id, decision: Promise.resolve({ outcome: 'denied', reason }) };
    }

    this.db.insert(pendingApprovals).values(row).run();
    let fallback: NodeJS.Timeout | undefined;
    // Aborted when the approval settles or parks, so the client closes the form.
    const form = channel === 'form' ? new AbortController() : undefined;
    const decision = new Promise<Decision>((resolve) => {
      const timer = setTimeout(() => settle({ outcome: 'timed_out' }), input.timeoutMs);
      const settle = (d: Decision) => {
        if (!this.live.delete(id)) return; // first decision wins
        clearTimeout(timer);
        clearTimeout(fallback);
        form?.abort();
        const status = d.outcome === 'timed_out' ? 'timed_out' : d.outcome;
        this.db
          .update(pendingApprovals)
          .set({ status, decidedBy: d.decidedBy ?? null, decidedVia: d.via ?? null, decidedAt: this.now() })
          .where(and(eq(pendingApprovals.id, id), eq(pendingApprovals.status, 'pending')))
          .run();
        this.links.consumeAll(id);
        if (channel === 'url') prompts.urlComplete?.(id);
        resolve({ ...d, channel: d.channel ?? channel! });
      };
      this.live.set(id, { row, formApprovals: input.formApprovals, settle });
    });

    const offerLink = (park: ParkHook, info?: { formFallback: true }) => {
      const token = this.links.create(id, row.expiresAt);
      park.offer(
        {
          approvalId: id,
          path: `/a/${token}`,
          operationKey: input.operationKey,
          summary: input.summary,
          expiresAt: row.expiresAt,
          inSession: input.formApprovals,
        },
        info,
      );
    };
    if (channel === 'url') this.offerUrl(id, row.expiresAt, input);
    else if (channel === 'link') offerLink(input.park!);
    else {
      this.offerForm(id, input, form!.signal);
      const park = input.park;
      // A client may advertise forms and never show them (ADR-0006): the same approval moves to the link.
      if (park)
        fallback = setTimeout(() => {
          if (!this.live.has(id) || park.reserve()) return;
          channel = 'link';
          form!.abort();
          offerLink(park, { formFallback: true });
        }, this.formFallbackMs);
    }
    return { id, decision };
  }

  private message(input: ApprovalRequestInput, trailer: string) {
    return [input.summary, '', `Operation: ${input.operationKey} (${input.classification})`, '', trailer].join('\n');
  }

  private offerUrl(id: string, expiresAt: Date, input: ApprovalRequestInput) {
    const token = this.links.create(id, expiresAt);
    const clientDenied = (reason: string): Decision => ({
      outcome: 'denied',
      via: 'elicitation',
      decidedBy: input.client.id,
      reason,
    });
    input.prompts!.url!({
      approvalId: id,
      path: `/a/${token}`,
      message: this.message(input, 'Open the approval page to review the details and approve or deny.'),
    }).then(
      (res) => {
        // `accept` only means the page was opened; the decision is made there.
        if (res.action !== 'accept') this.live.get(id)?.settle(clientDenied('declined'));
      },
      // The client could not show the prompt: nobody can reach the page, so don't wait for the timeout.
      () => this.live.get(id)?.settle(clientDenied('prompt_failed')),
    );
  }

  private offerForm(id: string, input: ApprovalRequestInput, signal: AbortSignal) {
    const message = this.message(
      input,
      `Parameters: ${JSON.stringify(input.paramsDisplay)}${input.diff ? `\nChanges: ${JSON.stringify(input.diff)}` : ''}\n\nAccept to approve this call, Decline to deny it.`,
    );
    input.prompts!.form!({ approvalId: id, message, requestedSchema: { type: 'object', properties: {} } }, signal).then(
      (res) => {
        // After the call parked, the link decides; a late answer of the aborted form counts for nothing.
        if (signal.aborted) return;
        const outcome = res.action === 'accept' ? 'approved' : 'denied';
        this.live.get(id)?.settle({ outcome, via: 'elicitation', decidedBy: input.client.id });
      },
      () => {
        if (!signal.aborted) this.live.get(id)?.settle({ outcome: 'denied', reason: 'prompt_failed' });
      },
    );
  }

  /** An approval with its operation and endpoint, for the approval page. */
  withDetails(id: string) {
    return (
      this.db
        .select({ approval: pendingApprovals, op: operations, instance: pluginInstances })
        .from(pendingApprovals)
        .innerJoin(operations, eq(pendingApprovals.operationId, operations.id))
        .innerJoin(pluginInstances, eq(pendingApprovals.instanceId, pluginInstances.id))
        .where(eq(pendingApprovals.id, id))
        .get() ?? null
    );
  }

  private open(id: string): Live {
    const live = this.live.get(id);
    if (live) return live;
    const row = this.db.select().from(pendingApprovals).where(eq(pendingApprovals.id, id)).get();
    if (!row) throw new NotFoundError('approval_not_found', 'No such approval');
    throw new ConflictError('approval_closed', `This approval is already ${row.status}`);
  }

  /** The approval page's decision. A wrong typed confirmation is rejected so the approver can retry. */
  decide(id: string, input: PageDecisionInput): Decision {
    const live = this.open(id);
    if (input.approve && live.row.confirmLiteral && input.confirm !== live.row.confirmLiteral) {
      throw new ValidationError('confirmation_mismatch', `Type "${live.row.confirmLiteral}" exactly to approve`);
    }
    const base = {
      outcome: input.approve ? 'approved' : 'denied',
      via: 'url',
      decidedBy: input.decidedBy,
      ...(input.decidedById ? { decidedById: input.decidedById } : {}),
      ...(input.signIn ? { signIn: input.signIn } : {}),
    } as const;
    const decision: Decision =
      input.approve && input.sessionGrantUntil
        ? { ...base, decidedById: input.decidedById, sessionGrantUntil: input.sessionGrantUntil }
        : base;
    live.settle(decision);
    return decision;
  }

  /** The approval card's decision in the agent session (ADR-0006): only where the endpoint still allows it, and
   * never with a session grant. The caller checks that the approval belongs to the calling principal. */
  decideInSession(id: string, input: { approve: boolean; decidedBy: string }): Decision {
    const live = this.open(id);
    const instance = this.db
      .select({ slug: pluginInstances.slug, settings: pluginInstances.settings })
      .from(pluginInstances)
      .where(eq(pluginInstances.id, live.row.instanceId))
      .get();
    const allowed =
      live.formApprovals &&
      !live.row.confirmLiteral &&
      !!instance &&
      readInstanceSettings(instance.settings, `/${instance.slug} settings`).formElicitationApprovals === 'ask';
    if (!allowed) throw new ForbiddenError('approval_not_in_session', 'This approval needs the approval page');
    const decision: Decision = {
      outcome: input.approve ? 'approved' : 'denied',
      via: 'elicitation',
      channel: 'card',
      decidedBy: input.decidedBy,
    };
    live.settle(decision);
    return decision;
  }

  /** Cancels one open request (its execution ended). Returns false if it was already decided. */
  cancel(id: string, reason: string): boolean {
    const live = this.live.get(id);
    if (!live) return false;
    live.settle({ outcome: 'cancelled', reason });
    return true;
  }

  /** Cancels the open requests of one endpoint (it was stopped: disabled, deleted or reconfigured). */
  cancelForInstance(instanceId: string, reason: string): number {
    const mine = [...this.live.values()].filter((l) => l.row.instanceId === instanceId);
    for (const live of mine) live.settle({ outcome: 'cancelled', reason });
    return mine.length;
  }

  /** Cancels the open requests one user owns (the user is deleted). */
  cancelForOwner(userId: string, reason: string): number {
    const mine = [...this.live.values()].filter((l) => l.row.ownerUserId === userId);
    for (const live of mine) live.settle({ outcome: 'cancelled', reason });
    return mine.length;
  }

  /** Cancels every open request (shutdown). Cancelled calls are denied to the sandbox. */
  cancelAll(reason = 'shutdown') {
    for (const live of [...this.live.values()]) live.settle({ outcome: 'cancelled', reason });
  }
}
