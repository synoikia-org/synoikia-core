import { Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';
import type { CoreEvents } from './events.js';
import type { InstanceManager } from './instances/manager.js';
import { CORE_VERSION } from './version.js';

/** An open MCP session as the metrics see it: its endpoint and the app name its client sent. */
export interface OpenSession {
  slug: string;
  app?: string;
}

const MAX_APPS = 32;
const MAX_APP_LENGTH = 64;
const ACTIVE_MS = 60 * 60 * 1000;

/** ADR-0024: the client names its app, so its label is normalized, and only the first 32 names keep their own. */
export function appLabel(name: string | undefined, known: Set<string>): string {
  const label = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, MAX_APP_LENGTH);
  if (!label) return 'unknown';
  if (known.has(label)) return label;
  if (known.size >= MAX_APPS) return 'other';
  known.add(label);
  return label;
}

/** The metrics of core (ADR-0024): counters from the event bus, gauges read from their owners at each scrape. */
export class Metrics {
  readonly registry = new Registry();
  private readonly lastCall = new Map<string, number>();
  private readonly apps = new Set<string>();
  private sessions: () => OpenSession[] = () => [];

  constructor(events: CoreEvents, instances: InstanceManager, now: () => Date) {
    const registers = [this.registry];
    new Gauge({ name: 'synoikia_build_info', help: 'The version of core.', labelNames: ['version'], registers })
      .labels(CORE_VERSION)
      .set(1);

    const calls = new Counter({
      name: 'synoikia_calls_total',
      help: 'Calls of agent code to an operation, by instance and outcome.',
      labelNames: ['instance', 'outcome'],
      registers,
    });
    const durations = new Histogram({
      name: 'synoikia_call_duration_seconds',
      help: 'How long a call took to answer, by instance.',
      labelNames: ['instance'],
      registers,
    });
    events.on('call.finished', ({ slug, outcome, durationMs, userId }) => {
      calls.labels(slug, outcome).inc();
      if (outcome !== 'awaiting_approval') durations.labels(slug).observe(durationMs / 1000);
      if (userId) this.lastCall.set(userId, now().getTime());
    });

    const approvals = new Counter({
      name: 'synoikia_approvals_total',
      help: 'Approvals that ended, by instance and how they ended.',
      labelNames: ['instance', 'outcome'],
      registers,
    });
    events.on('approval.ended', ({ instanceId, outcome }) => {
      const slug = instances.list().find((i) => i.id === instanceId)?.slug;
      if (slug) approvals.labels(slug, outcome).inc();
    });

    const refused = new Counter({
      name: 'synoikia_agent_sign_in_failures_total',
      help: 'Agent requests refused for their credential.',
      registers,
    });
    events.on('credential.refused', () => refused.inc());

    const lastCall = this.lastCall;
    new Gauge({
      name: 'synoikia_active_users',
      help: 'Users with a call in the last hour.',
      registers,
      collect() {
        const since = now().getTime() - ACTIVE_MS;
        for (const [user, at] of lastCall) if (at < since) lastCall.delete(user);
        this.set(lastCall.size);
      },
    });
    new Gauge({
      name: 'synoikia_plugins_installed',
      help: 'Installed plugins.',
      registers,
      collect() {
        this.set(instances.listPlugins().length);
      },
    });
    new Gauge({
      name: 'synoikia_instances',
      help: 'Configured instances.',
      registers,
      collect() {
        this.set(instances.list().length);
      },
    });
    new Gauge({
      name: 'synoikia_instance_state',
      help: 'The state of each instance: 1 for its current state.',
      labelNames: ['instance', 'state'],
      registers,
      collect() {
        this.reset();
        for (const i of instances.list()) this.labels(i.slug, instances.status(i.id)).set(1);
      },
    });

    const open = () => this.sessions();
    const apps = this.apps;
    new Gauge({
      name: 'synoikia_sessions_open',
      help: 'Open agent sessions, by instance.',
      labelNames: ['instance'],
      registers,
      collect() {
        this.reset();
        for (const s of open()) this.labels(s.slug).inc();
      },
    });
    new Gauge({
      name: 'synoikia_sessions_by_app',
      help: 'Open agent sessions, by the app that the agent runs in.',
      labelNames: ['app'],
      registers,
      collect() {
        this.reset();
        for (const s of open()) this.labels(appLabel(s.app, apps)).inc();
      },
    });
  }

  /** The MCP endpoints hand over their open sessions here, since the metrics listener does not own them. */
  readSessionsFrom(source: () => OpenSession[]) {
    this.sessions = source;
  }
}
