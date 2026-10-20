import type { PluginHarness } from '../index.js';
import type { ComplianceFake, ComplianceProfile } from './profile.js';

/** The plugin under test in a compliance run: its profile, its fake and core's harness. */
export interface ComplianceSubject {
  pluginDir: string;
  profile: ComplianceProfile;
  fake?: ComplianceFake;
  harness: PluginHarness;
}

/** What the feature files of one run share, kept on `globalThis` because the steps load once for each file. */
export interface ComplianceRun {
  ended: number;
  subject(): Promise<ComplianceSubject>;
  stop(): Promise<void>;
}

const RUN = Symbol.for('synoikia.compliance.run');
const holder = globalThis as { [RUN]?: ComplianceRun };

export const currentRun = () => holder[RUN];
export const startRun = (run: ComplianceRun) => (holder[RUN] ??= run);

/** The plugin under test, for the step files of a plugin's own feature files. */
export function complianceSubject(): Promise<ComplianceSubject> {
  const run = currentRun();
  if (!run) throw new Error('complianceSubject() works only in a run of complianceConfig()');
  return run.subject();
}
