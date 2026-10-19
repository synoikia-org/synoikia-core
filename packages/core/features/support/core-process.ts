import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SynoikiaWorld } from './world.js';

const CORE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NODE_ARGS = ['--no-node-snapshot', '--conditions=synoikia-source', '--import', 'tsx'];

/** Core as the operator runs it: `src/main.ts` in its own process, with its output as its server log. */
export interface CoreProcess {
  child: ChildProcess;
  log: string;
  /** Set once the process ended, with its exit code. */
  exitCode?: number | null;
  adminBase: string;
  mcpBase: string;
  exited: Promise<void>;
}

const baseEnv = () => ({ PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' });

/** Starts core on `dataDir` and waits until it listens, or until it stops at start-up. */
export async function startCoreProcess(world: SynoikiaWorld, dataDir: string, env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [...NODE_ARGS, 'src/main.ts'], {
    cwd: CORE,
    env: {
      ...baseEnv(),
      DATA_DIR: dataDir,
      MCP_HOST: '127.0.0.1',
      MCP_PORT: '0',
      ADMIN_HOST: '127.0.0.1',
      ADMIN_PORT: '0',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const run: CoreProcess = {
    child,
    log: '',
    adminBase: '',
    mcpBase: '',
    exited: new Promise<void>((resolve) =>
      child.once('exit', (code) => {
        run.exitCode = code;
        resolve();
      }),
    ),
  };
  world.cleanups.push(async () => {
    if (run.exitCode === undefined) child.kill('SIGKILL');
    await run.exited;
  });
  await new Promise<void>((resolve) => {
    const read = (chunk: Buffer) => {
      run.log += chunk.toString();
      const mcp = /MCP listener on 127\.0\.0\.1:(\d+)/.exec(run.log);
      const admin = /Admin listener on 127\.0\.0\.1:(\d+)/.exec(run.log);
      if (mcp && admin) {
        run.mcpBase = `http://127.0.0.1:${mcp[1]}`;
        run.adminBase = `http://127.0.0.1:${admin[1]}`;
        resolve();
      }
    };
    child.stdout!.on('data', read);
    child.stderr!.on('data', read);
    void run.exited.then(() => resolve());
  });
  return run;
}

/** Runs an operator command of core (`src/cli.ts`) to its end. */
export async function runCli(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, [...NODE_ARGS, 'src/cli.ts', ...args], {
    cwd: CORE,
    env: { ...baseEnv(), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (c: Buffer) => (output += c.toString()));
  child.stderr.on('data', (c: Buffer) => (output += c.toString()));
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  return { code, output };
}
