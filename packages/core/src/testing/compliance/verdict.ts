import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Reporter, TestModule, Vitest } from 'vitest/node';

/** The line a failed step of the suite gives for each broken rule. */
export const FAILED_RULE = 'Failed rule: ';

/** Prints core's verdict once the run ends: fit for production only when every scenario of the suite passed. */
export class VerdictReporter implements Reporter {
  private vitest?: Vitest;
  constructor(
    private readonly pluginDir: string,
    private readonly suiteDir: string,
  ) {}

  onInit(vitest: Vitest) {
    this.vitest = vitest;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>) {
    const manifest = JSON.parse(readFileSync(path.join(this.pluginDir, 'manifest.json'), 'utf8')) as {
      name: string;
      version: string;
    };
    const suite = testModules.filter((m) => m.moduleId.startsWith(this.suiteDir + path.sep));
    const failures = new Set<string>();
    // A filtered run is not a verdict: each suite file must run, and each of its scenarios.
    const loaded = new Set(suite.map((m) => path.basename(m.moduleId)));
    for (const file of globSync('*.feature', { cwd: this.suiteDir }))
      if (!loaded.has(file)) failures.add(`the suite file ${file} did not run`);
    let ran = 0;
    for (const module of suite) {
      for (const error of module.errors()) failures.add(`${path.basename(module.moduleId)}: ${error.message}`);
      for (const test of module.children.allTests()) {
        const result = test.result();
        if (result.state === 'skipped' || result.state === 'pending') {
          failures.add(`${test.name} did not run`);
          continue;
        }
        ran++;
        if (result.state !== 'failed') continue;
        const lines = (result.errors ?? []).flatMap((e) => (e.message ?? '').split('\n'));
        const rules = lines.filter((l) => l.startsWith(FAILED_RULE)).map((l) => l.slice(FAILED_RULE.length));
        for (const rule of rules.length ? rules : [`${test.name}: ${lines[0] ?? 'failed'}`]) failures.add(rule);
      }
    }
    if (ran === 0 && failures.size === 0) failures.add('the compliance suite did not run');
    const name = `${manifest.name} ${manifest.version}`;
    const log = (line: string) => (this.vitest ? this.vitest.logger.log(line) : console.log(line));
    if (failures.size === 0) return log(`\n${name} is fit for production.`);
    log(`\n${name} is not fit for production.`);
    for (const failure of failures) log(`${FAILED_RULE}${failure}`);
  }
}
