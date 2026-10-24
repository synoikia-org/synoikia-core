import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bumpVersion,
  compareVersions,
  escapeTitle,
  imageVersionOf,
  parseVersions,
  planRelease,
  releaseErrors,
  renderBody,
} from './plan.mjs';

const current = { sdk: '0.9.0', core: '0.25.0', 'create-plugin': '0.8.9', image: '0.23.0' };

/** @param {string[]} files @param {string[]} [labels] @param {number} [number] */
const pr = (files, labels = [], number = 1) => ({ sha: `sha${number}`, files, number, title: `PR ${number}`, labels });
/** @param {import('./plan.mjs').Change[]} list */
const all = (list) => ({ sdk: list, core: list, 'create-plugin': list, image: list });
/** @param {ReturnType<typeof planRelease>['plan']} plan */
const versionsOf = (plan) => Object.fromEntries(Object.entries(plan).map(([id, p]) => [id, p.version]));

describe('bumpVersion', () => {
  it('bumps the minor for a breaking change while at 0.x', () => {
    assert.equal(bumpVersion('0.9.3', 'major'), '0.10.0');
    assert.equal(bumpVersion('1.9.3', 'major'), '2.0.0');
    assert.equal(bumpVersion('0.9.3', 'minor'), '0.10.0');
    assert.equal(bumpVersion('0.9.3', 'patch'), '0.9.4');
  });
});

describe('planRelease', () => {
  it('releases nothing without changes to shipped paths', () => {
    const { release, plan } = planRelease(current, all([pr(['docs/a.md', 'packages/core/test/a.test.ts'])]));
    assert.equal(release, false);
    assert.deepEqual(versionsOf(plan), current);
  });

  it('bumps a portal fix in the image only', () => {
    const { plan } = planRelease(current, all([pr(['packages/admin-ui/src/App.vue'])]));
    assert.deepEqual(versionsOf(plan), { ...current, image: '0.23.1' });
  });

  it('bumps create-plugin and the image when the SDK takes a minor bump', () => {
    const { plan } = planRelease(current, all([pr(['packages/plugin-sdk/src/rules.ts'], ['feature'])]));
    assert.deepEqual(versionsOf(plan), { sdk: '0.10.0', core: '0.25.0', 'create-plugin': '0.8.10', image: '0.24.0' });
  });

  it('bumps the image by the largest step of the release', () => {
    const { plan } = planRelease(
      current,
      all([pr(['packages/create-plugin/templates/a.ts'], ['breaking'], 1), pr(['packages/core/src/a.ts'], [], 2)]),
    );
    assert.deepEqual(versionsOf(plan), { sdk: '0.9.0', core: '0.25.1', 'create-plugin': '0.9.0', image: '0.24.0' });
    assert.deepEqual(
      plan.core?.changes.map((c) => c.number),
      [2],
    );
  });

  it('counts only the changes since the release of each artifact', () => {
    const { plan } = planRelease(current, { sdk: [], core: [pr(['packages/core/src/a.ts'])] });
    assert.deepEqual(versionsOf(plan), { ...current, core: '0.25.1', image: '0.23.1' });
  });
});

describe('the versions block', () => {
  it('reads back what the draft writes', () => {
    const { plan } = planRelease(current, all([pr(['packages/core/src/a.ts'], ['feature'], 7)]));
    const body = renderBody(plan, current);
    assert.match(body, /## @synoikia\/core 0\.26\.0\n\n- PR 7 \(#7\) \[feature\]/);
    assert.match(body, /## Docker image 0\.24\.0/);
    assert.doesNotMatch(body, /## @synoikia\/plugin-sdk/);
    assert.deepEqual(parseVersions(body), { sdk: '0.9.0', core: '0.26.0', 'create-plugin': '0.8.10' });
  });

  it('refuses an unknown name or a bad version', () => {
    const block = (/** @type {string} */ line) => `\`\`\`text synoikia-versions\n${line}\n\`\`\`\n`;
    assert.throws(() => parseVersions(block('left-pad 1.0.0')), /bad versions line/);
    assert.throws(() => parseVersions(block('@synoikia/core 1.0')), /bad versions line/);
    assert.throws(() => parseVersions(block('@synoikia/core 1.0.0; rm -rf /')), /bad versions line/);
    assert.equal(parseVersions('no block'), undefined);
    assert.throws(() => parseVersions(block('@synoikia/core 1.0.0') + block('@synoikia/core 9.0.0')), /two versions/);
  });

  it('keeps a pull request title from mentioning or opening a fence', () => {
    assert.equal(escapeTitle("Fix @someone's `code`\n```text"), "Fix `@someone`'s 'code' '''text");
  });

  it('takes the image version from the tag', () => {
    assert.equal(imageVersionOf('v0.24.0'), '0.24.0');
    assert.equal(imageVersionOf('v0.24.0-rc.1'), '0.24.0-rc.1');
    assert.throws(() => imageVersionOf('0.24.0'), /v<version>/);
  });
});

describe('releaseErrors', () => {
  const published = { sdk: '0.9.0', core: '0.25.0', 'create-plugin': '0.8.9', image: '0.23.0' };

  it('accepts new versions and versions already published', () => {
    const versions = { ...published, core: '0.26.0', image: '0.24.0' };
    assert.deepEqual(releaseErrors({ versions, prerelease: false, published }), []);
  });

  it('refuses a version below the published one', () => {
    const versions = { ...published, core: '0.2.60', image: '0.22.0' };
    assert.deepEqual(releaseErrors({ versions, prerelease: false, published }), [
      '@synoikia/core 0.2.60 is below 0.25.0',
      'image 0.22.0 is below 0.23.0',
    ]);
  });

  it('refuses a pre-release setting that the versions do not follow', () => {
    assert.deepEqual(releaseErrors({ versions: { ...published, image: '0.24.0' }, prerelease: true, published }), [
      'image 0.24.0 needs a prerelease part',
    ]);
    assert.deepEqual(releaseErrors({ versions: { ...published, sdk: '0.10.0-rc.0' }, prerelease: false, published }), [
      '@synoikia/plugin-sdk 0.10.0-rc.0 cannot have a prerelease part',
    ]);
  });

  it('orders a prerelease below its release', () => {
    assert.ok(compareVersions('0.24.0-rc.0', '0.24.0') < 0);
    assert.ok(compareVersions('0.24.0', '0.23.9') > 0);
  });
});
