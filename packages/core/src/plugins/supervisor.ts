import type { InitParams } from '@synoikia/plugin-sdk';
import { SDK_VERSION } from '@synoikia/plugin-sdk';
import { PluginProcess, PluginUnavailableError, PluginUnresponsiveError } from './process.js';
import type { SpawnOptions } from './process.js';

/** Keeps one instance's child alive (ADR-0014): spawn → init → ready, restarting with backoff after
 * a crash; while it is down callers get `PluginUnavailableError`, never a fail-open gate. */

export type InstanceStatus = 'stopped' | 'starting' | 'ready' | 'error' | 'idle';

export interface SupervisorOptions extends SpawnOptions {
  /** Called on every start with this instance's config and freshly decrypted secrets. */
  loadInit: () => Omit<InitParams, 'sdkVersion' | 'instanceId'>;
  onStatus?: (status: InstanceStatus, error?: string) => void;
  onLog?: (level: string, message: string) => void;
  onCatalogChanged?: (reason?: string) => void;
  onInvalidMessage?: () => void;
  onHandlerFault?: (error: unknown) => void;
  initTimeoutMs?: number;
  backoff?: { initialMs: number; maxMs: number };
  /** ADR-0023: the interval core asks the child to send heartbeats at; three missed ones restart it. */
  heartbeatMs?: number;
}

export class PluginSupervisor {
  private proc?: PluginProcess;
  private _status: InstanceStatus = 'stopped';
  private stopping = false;
  private restartTimer?: NodeJS.Timeout;
  private attempt = 0;
  private generation = 0;
  private idleGeneration = -1;
  private queue: Promise<void> = Promise.resolve();
  private watch?: NodeJS.Timeout;

  constructor(private readonly opts: SupervisorOptions) {}

  get status(): InstanceStatus {
    return this._status;
  }

  /** The live process for RPC calls. Throws unless the instance is ready. */
  get client(): PluginProcess {
    if (this._status !== 'ready' || !this.proc?.running) throw this.notReady();
    return this.proc;
  }

  /** The error for a call while the child is down: it tells the caller when the child stopped answering. */
  notReady(message?: string): PluginUnavailableError {
    return this.stoppedAnswering ? new PluginUnresponsiveError() : new PluginUnavailableError(message);
  }

  private stoppedAnswering = false;

  async start(): Promise<void> {
    return this.serial(async () => {
      this.stopping = false;
      if (this.proc) return; // already running or starting
      await this.spawn();
    });
  }

  async stop(): Promise<void> {
    this.halt();
    return this.serial(() => this.shutdown());
  }

  /** Restart now (e.g. after the admin changed the connection config or secrets). */
  async restart(): Promise<void> {
    this.halt();
    return this.serial(async () => {
      await this.shutdown();
      this.attempt = 0;
      this.stopping = false;
      await this.spawn();
    });
  }

  /** ADR-0022: stops a ready child while `unused` holds; `wake` starts it again. Ends nothing else. */
  async idle(unused: () => boolean): Promise<void> {
    return this.serial(async () => {
      if (this._status !== 'ready' || this.stopping || !unused()) return;
      this.stopping = true;
      this.idleGeneration = ++this.generation;
      const proc = this.proc;
      this.proc = undefined;
      // Idle before the child exits, so a call that comes now waits for a new start instead of this child.
      this.setStatus('idle');
      await proc?.stop();
    });
  }

  /** Starts an idle child; callers that come during the start wait for the same one. */
  async wake(): Promise<void> {
    return this.serial(async () => {
      // A stop or restart since the idle stop wins: the secrets go to no child that will not serve.
      if (this._status !== 'idle' || this.generation !== this.idleGeneration) return;
      this.stopping = false;
      this.attempt = 0;
      await this.spawn();
    });
  }

  /** Lifecycle changes run one at a time, so at most one child lives and a stop is never undone. */
  private serial(fn: () => Promise<void>): Promise<void> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Supersedes whatever is in flight at once: a child still in `init` is killed, not waited for. */
  private halt() {
    this.stopping = true;
    this.generation++;
    clearTimeout(this.restartTimer);
    if (this._status === 'starting') this.proc?.kill();
  }

  private async shutdown() {
    this.stopping = true;
    this.generation++;
    clearTimeout(this.restartTimer);
    const proc = this.proc;
    this.proc = undefined;
    await proc?.stop();
    this.setStatus('stopped');
  }

  private setStatus(status: InstanceStatus, error?: string) {
    this._status = status;
    this.opts.onStatus?.(status, error);
  }

  private async spawn(): Promise<void> {
    const generation = ++this.generation;
    this.setStatus('starting');
    const proc = new PluginProcess(this.opts);
    this.proc = proc;
    proc.on('log', (level, message) => this.opts.onLog?.(level, message));
    proc.on('catalogChanged', (reason) => this.opts.onCatalogChanged?.(reason));
    proc.on('heartbeat', () => this.watchHeartbeats(proc, generation));
    proc.on('invalidMessage', () => this.opts.onInvalidMessage?.());
    proc.on('handlerFault', (err) => this.opts.onHandlerFault?.(err));
    proc.on('exit', (code, signal) => {
      if (this.stopping || generation !== this.generation) return;
      this.scheduleRestart(`plugin exited unexpectedly (${signal ?? `code ${code}`})`);
    });
    try {
      // Before the fork: what loadInit records about the bundle (its version) describes the code the
      // child is about to load, not whatever replaced it after.
      const init = this.opts.loadInit();
      proc.start();
      await proc.call(
        'init',
        { ...init, instanceId: this.opts.instanceId, sdkVersion: SDK_VERSION, heartbeatMs: this.heartbeatMs },
        this.opts.initTimeoutMs ?? 30_000,
      );
    } catch (err) {
      proc.kill();
      if (generation !== this.generation) return;
      this.scheduleRestart(`init failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (generation !== this.generation) {
      // Superseded (stopped or restarted) during init: this child must not outlive its turn.
      proc.kill();
      return;
    }
    this.attempt = 0;
    this.stoppedAnswering = false;
    this.setStatus('ready');
  }

  private get heartbeatMs() {
    return this.opts.heartbeatMs ?? 5000;
  }

  /** ADR-0023: watches a child from its first heartbeat, so a child that sends none is never watched. */
  private watchHeartbeats(proc: PluginProcess, generation: number) {
    this.lastBeat = Date.now();
    if (this.watch) return;
    this.watch = setInterval(() => {
      if (generation !== this.generation || this.proc !== proc) return this.unwatch();
      if (Date.now() - this.lastBeat < 3 * this.heartbeatMs) return;
      this.unwatch();
      this.stoppedAnswering = true;
      this.scheduleRestart('plugin stopped answering');
      proc.killUnresponsive();
    }, this.heartbeatMs);
    this.watch.unref();
  }

  private lastBeat = 0;

  private unwatch() {
    clearInterval(this.watch);
    this.watch = undefined;
  }

  private scheduleRestart(reason: string) {
    if (this.stopping) return;
    this.unwatch();
    this.generation++;
    this.proc = undefined;
    this.setStatus('error', reason);
    const { initialMs, maxMs } = this.opts.backoff ?? { initialMs: 1000, maxMs: 60_000 };
    const delay = Math.min(maxMs, initialMs * 2 ** this.attempt++);
    clearTimeout(this.restartTimer);
    const generation = this.generation;
    this.restartTimer = setTimeout(() => {
      void this.serial(async () => {
        if (!this.stopping && generation === this.generation) await this.spawn();
      });
    }, delay);
  }
}
