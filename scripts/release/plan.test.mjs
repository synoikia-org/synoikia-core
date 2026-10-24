import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bumpVersion, imageVersionOf, parseVersions, planRelease, renderBody } from './plan.mjs';

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
  });

  it('takes the image version from the tag', () => {
    assert.equal(imageVersionOf('v0.24.0'), '0.24.0');
    assert.equal(imageVersionOf('v0.24.0-rc.1'), '0.24.0-rc.1');
    assert.throws(() => imageVersionOf('0.24.0'), /v<version>/);
  });
});
