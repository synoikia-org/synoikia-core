import { z } from 'zod';
import { cleanStored, parseLeniently } from '../lenient.js';

/** Per-instance runtime settings, stored as JSON on `plugin_instances.settings`. */
export const InstanceSettingsSchema = z
  .object({
    /** Unanswered approvals are auto-denied after this long. */
    approvalTimeoutMs: z
      .number()
      .int()
      .min(10_000)
      .max(24 * 60 * 60_000)
      .default(15 * 60_000),
    /** `ask`: approve non-locked Ask operations (reads too) in the agent session, by form prompt or the approval
     * card (ADR-0006). Off by default: a client could then approve its own calls. Other stored values read as off. */
    formElicitationApprovals: z.enum(['off', 'ask']).default('off'),
    /** Longest session grant an approver can give (ADR-0006); 0 turns "Approve for this session" off. */
    sessionGrantMaxHours: z.number().int().min(0).max(24).default(8),
    /** `execute` and `search` runs per minute, per principal (ADR-0003). */
    executePerMinute: z.number().int().min(1).max(10_000).default(30),
    writesPerMinute: z.number().int().min(1).max(10_000).default(10),
    /** Runs that go at once on this instance; more wait for a place (ADR-0003). */
    runsAtOnce: z.number().int().min(1, 'must be at least 1').max(256).default(4),
    sandbox: z
      .object({
        timeoutMs: z.number().int().min(100).max(120_000).default(10_000),
        memoryMb: z.number().int().min(8).max(1024).default(64),
        maxResultBytes: z
          .number()
          .int()
          .min(1024)
          .max(4 * 1024 * 1024)
          .default(64 * 1024),
      })
      .prefault({}),
    extraRedactKeys: z.array(z.string().min(1)).default([]),
    /** Re-sync the catalog on session start when the last sync is older than this (@id:catalog-sync-schedule). */
    syncMaxAgeMs: z
      .number()
      .int()
      .min(60_000)
      .max(7 * 24 * 60 * 60_000)
      .default(60 * 60_000),
    /** How long nobody calls an `on-demand` plugin before its child stops; null keeps it running (ADR-0022). */
    idleStopMs: z
      .number()
      .int()
      .min(5 * 60_000)
      .max(24 * 60 * 60_000)
      .nullable()
      .default(null),
    /** Plugin child heap limit (ADR-0014). */
    memoryMb: z.number().int().min(64).max(4096).default(256),
  })
  .prefault({});

export type InstanceSettings = z.infer<typeof InstanceSettingsSchema>;

export function parseInstanceSettings(raw: unknown): InstanceSettings {
  return InstanceSettingsSchema.parse(raw ?? {});
}

/** Stored instance settings, read leniently (a field a newer schema rejects falls back to its default). */
export function readInstanceSettings(raw: unknown, label = 'instance settings'): InstanceSettings {
  return parseLeniently(InstanceSettingsSchema, raw, label);
}

/** For the startup normalization: the stored settings with just the rejected fields removed. */
export function cleanInstanceSettings(raw: unknown, label: string) {
  return cleanStored(InstanceSettingsSchema, raw, label);
}
