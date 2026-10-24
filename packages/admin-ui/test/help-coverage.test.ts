import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { forRole, parseTopic, TOPICS } from '../src/help/topics';
import { createAppRouter } from '../src/router';

// The gates of @id:portal-help: each page has its topic, each help link lands, and page text stays short.
const SRC = path.resolve(__dirname, '../src');
const vueFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? vueFiles(path.join(dir, e.name)) : e.name.endsWith('.vue') ? [path.join(dir, e.name)] : [],
  );
const sources = vueFiles(SRC).map((file) => ({ file: path.relative(SRC, file), text: readFileSync(file, 'utf8') }));
// One short line: the length of a sentence, with no room for a second one.
const MAX_LINE = 100;
// A conditional part is a warning that reacts to the state, not an explanation.
const plain = (text: string) =>
  text
    .replace(/<template v-if[\s\S]*?<\/template\s*>/g, '')
    .replace(/\{\{[\s\S]*?\}\}/g, 'x')
    .replace(/\$\{[^}]*\}/g, 'x')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

describe('help coverage', () => {
  it('gives each signed-in page a help topic', () => {
    const router = createAppRouter(createMemoryHistory());
    const pages = router
      .getRoutes()
      .filter((r) => r.components?.default && !r.redirect && !r.children.length && !r.meta.public)
      .filter((r) => r.path !== '/enroll-totp');
    expect(pages.length).toBeGreaterThan(15);
    for (const page of pages) {
      const { meta } = router.resolve(page.path.replace(/:(\w+)/g, 'x'));
      expect(meta.help, page.path).toBeDefined();
      expect(TOPICS[meta.help!], `${page.path} → ${meta.help}`).toBeDefined();
    }
  });

  it('points each related topic and each section link at a topic that exists', () => {
    for (const topic of Object.values(TOPICS))
      for (const id of topic.related) expect(TOPICS[id], `${topic.id} → ${id}`).toBeDefined();
    const links = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/<HelpLink[^>]*topic="([^"]+)"[^>]*section="([^"]+)"/g)].map((m) => ({
        file,
        topic: m[1]!,
        section: m[2]!,
      })),
    );
    expect(links.length).toBeGreaterThan(0);
    for (const l of links)
      expect(
        TOPICS[l.topic]?.sections.map((s) => s.id),
        `${l.file}: ${l.topic}#${l.section}`,
      ).toContain(l.section);
  });

  it('keeps a page subtitle and the text under a field to one short line', () => {
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/\bsubtitle="([^"]*)"/g))
        expect(plain(m[1]!).length, `${file}: ${m[1]}`).toBeLessThanOrEqual(MAX_LINE);
      for (const m of text.matchAll(/<p\b[^>]*class="help[^"]*"[^>]*>([\s\S]*?)<\/p>/g))
        expect(plain(m[1]!).length, `${file}: ${m[1]!.trim()}`).toBeLessThanOrEqual(MAX_LINE);
    }
  });
});

describe('help topics', () => {
  const topic = parseTopic(
    'demo',
    '---\ntitle: Demo\naudience: everyone\nrelated: a, b\n---\nIntro.\n\n## Your part\n\nText.\n\n## Admin part {admin}\n\nMore.\n',
  );

  it('reads the front matter, the intro and the sections', () => {
    expect(topic).toMatchObject({ title: 'Demo', admin: false, related: ['a', 'b'], intro: 'Intro.' });
    expect(topic.sections).toEqual([
      { id: 'your-part', heading: 'Your part', admin: false, body: 'Text.' },
      { id: 'admin-part', heading: 'Admin part', admin: true, body: 'More.' },
    ]);
  });

  it('keeps admin sections and admin topics from the other roles', () => {
    expect(forRole(topic, false)?.sections.map((s) => s.id)).toEqual(['your-part']);
    expect(forRole({ ...topic, admin: true }, false)).toBeUndefined();
    expect(forRole(topic, true)).toBe(topic);
  });
});
