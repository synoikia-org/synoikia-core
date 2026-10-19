import { mergeConfig } from 'vitest/config';
import shared from '../../../../vitest.shared.js';
import { complianceConfig } from '../../src/testing/compliance/config.js';

// How plugin author 3 runs the compliance suite on a copy of Acme Tasks: the copy's vitest config, from core's sources.
export default mergeConfig(
  { resolve: shared.resolve, ssr: shared.ssr },
  complianceConfig({ pluginDir: process.env.SYNOIKIA_COMPLIANCE_PLUGIN! }),
);
