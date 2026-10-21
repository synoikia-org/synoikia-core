import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkPlugin } from '../src/check.js';
import { dependencyRange } from '../src/repo-root.js';
import { pluginFiles } from '../src/vitest.js';

const tmp: string[] = [];
const work = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'synoikia-cli-'));
  tmp.push(dir);
  return dir;
};
afterEach(() => {
  for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('templates', () => {
  it('resolves dependency ranges for generated packages', () => {
    expect(dependencyRange('yaml')).toBe('^2.9.1');
  });
});

describe('check', () => {
  it('reports a plugin folder without a manifest', () => {
    expect(checkPlugin(path.join(work(), 'nope'))[0]).toMatch(/^manifest.json: /);
  });
});

describe('data files', () => {
  it('gives vitest the same modules', () => {
    const dir = work();
    writeFileSync(path.join(dir, 'd.yaml'), 'n: 1\n');
    const plugin = pluginFiles();
    expect(plugin.transform('ignored', path.join(dir, 'd.yaml'))).toEqual({
      code: 'export default {"n":1};\n',
      map: null,
    });
    expect(plugin.transform('# x', '/a/guide.md?raw')).toEqual({ code: 'export default "# x";\n', map: null });
    expect(plugin.transform('code', '/a/x.ts')).toBeUndefined();
  });
});
