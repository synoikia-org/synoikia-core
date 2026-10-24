/** The help topics of the portal (@id:portal-help): one Markdown file for each page, built into the bundle. */

export interface HelpSection {
  id: string;
  heading: string;
  /** Only for the Admin role (ADR-0010); the text is public in the repository anyway. */
  admin: boolean;
  body: string;
}

export interface HelpTopic {
  id: string;
  title: string;
  admin: boolean;
  related: string[];
  intro: string;
  sections: HelpSection[];
}

export const sectionId = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** Reads one topic: a front matter with `title`, `audience` and `related`, an intro, then `## ` sections. */
export function parseTopic(id: string, source: string): HelpTopic {
  const text = source.replace(/\r\n?/g, '\n');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const meta: Record<string, string> = {};
  for (const line of front?.[1]?.split('\n') ?? []) {
    const at = line.indexOf(':');
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  const [intro = '', ...parts] = text.slice(front?.[0].length ?? 0).split(/^## /m);
  const sections = parts.map((part) => {
    const [first = '', ...rest] = part.split('\n');
    const admin = /\s*\{admin\}\s*$/.test(first);
    const heading = first.replace(/\s*\{admin\}\s*$/, '').trim();
    return { id: sectionId(heading), heading, admin, body: rest.join('\n').trim() };
  });
  return {
    id,
    title: meta.title ?? id,
    admin: meta.audience === 'admin',
    related: (meta.related ?? '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    intro: intro.trim(),
    sections,
  };
}

/** What a person with or without the Admin role may read of a topic; undefined when nothing. */
export function forRole(topic: HelpTopic, isAdmin: boolean): HelpTopic | undefined {
  if (isAdmin) return topic;
  if (topic.admin) return undefined;
  return { ...topic, sections: topic.sections.filter((s) => !s.admin) };
}

const files = import.meta.glob<string>('./*.md', { query: '?raw', import: 'default', eager: true });

export const TOPICS: Record<string, HelpTopic> = Object.fromEntries(
  Object.entries(files).map(([file, source]) => {
    const id = file.replace(/^\.\/|\.md$/g, '');
    return [id, parseTopic(id, source)];
  }),
);

export const EDIT_URL = (id: string) =>
  `https://github.com/synoikia-org/synoikia-core/edit/main/packages/admin-ui/src/help/${id}.md`;
