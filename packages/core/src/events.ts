import { EventEmitter } from 'node:events';

export type CallOutcome = 'done' | 'denied' | 'failed' | 'awaiting_approval';

/** In-process event bus (ADR-0019) for notifiers, admin SSE and metrics; payloads never carry params or secrets. */
export interface CoreEventMap {
  'instance.status': [{ instanceId: string; slug: string; status: string; error?: string }];
  'plugin.crashed': [{ instanceId: string; slug: string; error: string }];
  'sync.completed': [
    {
      instanceId: string;
      slug: string;
      added: number;
      pendingReview: string[];
      newGroups: string[];
      rulesDisabled?: number;
    },
  ];
  'sync.failed': [{ instanceId: string; slug: string; error: string }];
  'auth.lockout': [{ username: string; ip?: string; surface?: 'admin' | 'mcp' }];
  // Only the metrics listener counts these (ADR-0024); they are not in CORE_EVENT_NAMES.
  'call.finished': [{ slug: string; outcome: CallOutcome; durationMs: number; userId?: string }];
  'approval.ended': [{ instanceId: string; outcome: 'approved' | 'denied' | 'timed_out' }];
  'credential.refused': [Record<string, never>];
}

export type CoreEventName = keyof CoreEventMap;

export const CORE_EVENT_NAMES: CoreEventName[] = [
  'instance.status',
  'plugin.crashed',
  'sync.completed',
  'sync.failed',
  'auth.lockout',
];

export class CoreEvents extends EventEmitter<CoreEventMap> {
  constructor() {
    super();
    // Several subscribers (notifier channels, SSE clients) is normal; don't warn at 10.
    this.setMaxListeners(0);
  }
}
