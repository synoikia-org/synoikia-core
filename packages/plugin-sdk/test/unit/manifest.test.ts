import { describe, expect, it } from 'vitest';
import { decodeInstructions, INSTRUCTIONS_MAX_BYTES, parseManifest } from '../../src/index.js';

const minimal = {
  id: 'example',
  name: 'Example',
  version: '1.0.0',
  sdk: '^0.2.0',
  entry: 'dist/index.js',
  binding: { namespace: 'example', functions: ['call'] },
  connection: { schema: { type: 'object' } },
};

describe('parseManifest', () => {
  it('decodes instructions within the cap, as UTF-8 text only', () => {
    const enc = new TextEncoder();
    expect(decodeInstructions(enc.encode('\uFEFF# Shape\n\nKeys are `GET /x`. ✓\n'))).toBe(
      '# Shape\n\nKeys are `GET /x`. ✓',
    );
    expect(decodeInstructions(enc.encode('a'.repeat(INSTRUCTIONS_MAX_BYTES)))).toHaveLength(INSTRUCTIONS_MAX_BYTES);
    expect(() => decodeInstructions(enc.encode('é'.repeat(INSTRUCTIONS_MAX_BYTES / 2 + 1)))).toThrow(
      `limit is ${INSTRUCTIONS_MAX_BYTES}`,
    );
    expect(() => decodeInstructions(new Uint8Array([0x41, 0xff, 0x41]))).toThrow('not valid UTF-8');
    expect(() => decodeInstructions(enc.encode('a\u0000b'))).toThrow('control characters');
    expect(() => decodeInstructions(enc.encode('a\u001b[31mb'))).toThrow('control characters');
    expect(decodeInstructions(enc.encode('a\tb\r\nc'))).toBe('a\tb\r\nc');
    for (const sneaky of ['a\u202Eb', 'a\u200Bb', 'a\uFEFFb', 'a\u2028b', 'a\u2029b', 'a\u00ADb'])
      expect(() => decodeInstructions(enc.encode(sneaky)), JSON.stringify(sneaky)).toThrow(/invisible/);
    for (const tag of ['x </plugin-notes> y', '<plugin-notes plugin="x">', '</ PLUGIN-NOTES>'])
      expect(() => decodeInstructions(enc.encode(tag)), tag).toThrow(/plugin-notes tag/);
  });

  it('refuses an options source shared by the connection form and a rule picker', () => {
    const withSources = (form: string, rule: string) => ({
      ...minimal,
      connection: {
        schema: { type: 'object', properties: { pool: { type: 'string' } } },
        ui: { pool: { widget: 'select', optionsSource: form } },
      },
      matchProfiles: { p: [{ field: '/app', label: 'App', op: 'in', widget: 'multiselect', optionsSource: rule }] },
    });
    expect(() => parseManifest(withSources('pools', 'pools'))).toThrow(/also feeds the connection form/);
    expect(parseManifest(withSources('pools', 'apps')).matchProfiles.p).toHaveLength(1);
  });

  it('requires the targets capability, and a targets declaration, for $targets match fields', () => {
    const profile = { p: [{ field: '$targets', label: 'Targets', widget: 'registry-picker' }] };
    const targets = { scopes: [{ key: 'zone', label: 'Zone' }] };
    expect(() => parseManifest({ ...minimal, matchProfiles: profile })).toThrow(/capabilities.targets/);
    expect(() => parseManifest({ ...minimal, capabilities: { targets: true }, matchProfiles: profile })).toThrow(
      /requires a targets declaration/,
    );
    expect(() => parseManifest({ ...minimal, targets })).toThrow(/targets requires capabilities.targets/);
    expect(
      parseManifest({ ...minimal, capabilities: { targets: true }, targets, matchProfiles: profile }).targets,
    ).toEqual({ label: 'Target', scopes: [{ key: 'zone', label: 'Zone' }] });
  });

  it('declares target scopes by key, and $targets fields may only offer or filter by declared ones', () => {
    const withTargets = (targets: unknown, options?: unknown) =>
      parseManifest({
        ...minimal,
        capabilities: { targets: true },
        targets,
        matchProfiles: { p: [{ field: '$targets', label: 'Targets', widget: 'registry-picker', options }] },
      });
    const targets = {
      label: 'Widget',
      registryKind: 'item',
      scopes: [
        { key: 'zone', label: 'Zone', registryKind: 'zone' },
        { key: 'type', label: 'Type' },
      ],
    };
    expect(withTargets(targets, { scopes: ['zone'], filter: { type: 'widget' } }).targets).toEqual(targets);
    expect(() => withTargets(targets, { scopes: ['floor'] })).toThrow(/floor.*is not declared in targets.scopes/);
    expect(() => withTargets(targets, { filter: { floor: '1' } })).toThrow(/floor.*is not declared in targets.scopes/);
    expect(() => withTargets(targets, { kinds: ['zone'] })).toThrow();
    expect(() => withTargets({ scopes: [{ key: 'Zone', label: 'Zone' }] })).toThrow(/lowercase/);
    expect(() =>
      withTargets({
        scopes: [
          { key: 'zone', label: 'Zone' },
          { key: 'zone', label: 'Area' },
        ],
      }),
    ).toThrow(/unique/);
  });

  it('accepts covers only on $targets fields, as a list of JSON pointers', () => {
    const withCovers = (field: Record<string, unknown>) =>
      parseManifest({
        ...minimal,
        capabilities: { targets: true },
        targets: { scopes: [] },
        matchProfiles: { p: [field] },
      });
    const targets = { field: '$targets', label: 'Targets', widget: 'registry-picker' };
    expect(withCovers({ ...targets, covers: ['/selector', '/host'] }).matchProfiles.p![0]).toMatchObject({
      covers: ['/selector', '/host'],
    });
    expect(() => withCovers({ ...targets, covers: ['selector'] })).toThrow(/JSON pointer/);
    expect(() => withCovers({ ...targets, covers: '/selector' })).toThrow();
    expect(() => withCovers({ ...targets, covers: [] })).toThrow();
    expect(() => withCovers({ field: '/name', label: 'Name', op: 'eq', widget: 'text', covers: ['/x'] })).toThrow(
      /only \$targets/,
    );
  });

  describe('connection ui', () => {
    const schema = {
      type: 'object',
      properties: { method: { type: 'string' }, password: { type: 'string', writeOnly: true } },
    };
    const withUi = (ui: unknown) => ({ ...minimal, connection: { schema, ui, help: 'Create a local user first.' } });

    it('accepts showWhen referencing another field', () => {
      const m = parseManifest(withUi({ password: { widget: 'secret', showWhen: { field: 'method', in: ['local'] } } }));
      expect(m.connection.ui.password?.showWhen).toEqual({ field: 'method', in: ['local'] });
      expect(m.connection.help).toBe('Create a local user first.');
    });
  });
});
