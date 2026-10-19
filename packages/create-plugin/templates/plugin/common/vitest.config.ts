import { existsSync } from 'node:fs';
import path from 'node:path';
import { complianceConfig } from '@synoikia/core/testing/compliance';
import { mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared.ts';

// Core's compliance suite certifies the plugin once test/compliance.yaml describes it. test/unit holds unit tests.
const pluginDir = import.meta.dirname;
const unit = { extends: true, test: { name: 'unit', include: ['test/unit/**/*.test.ts'] } };

export default existsSync(path.join(pluginDir, 'test', 'compliance.yaml'))
  ? mergeConfig(mergeConfig(shared, complianceConfig({ pluginDir })), { test: { projects: [unit] } })
  : shared;
