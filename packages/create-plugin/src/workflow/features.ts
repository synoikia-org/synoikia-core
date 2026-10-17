import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import type { Feature, GherkinDocument, Scenario, Step, Tag } from '@cucumber/messages';

export interface SourceFile {
  path: string;
  text: string;
}

export interface ParsedScenario {
  file: string;
  feature: string;
  rule: string | undefined;
  name: string;
  line: number;
  backlog: boolean;
}

const ALLOWED_TAG = /^@(?:id:[a-z0-9]+(?:-[a-z0-9]+)*|backlog|long-running)$/;
/** Words that put a solution in the spec: screens, wire formats and storage. */
const SOLUTION_WORDS = [
  /\b(?:click|tap|press)(?:s|es|ed)?\b/i,
  /\b(?:button|dropdown|checkbox|text ?field)s?\b/i,
  /\bendpoints?\b/i,
  /\bstatus code\b/i,
  /\b(?:HTTP|JSON|SQL|URL)\b/,
  /\b(?:GET|POST|PUT|PATCH|DELETE)\b/,
  /\/api\//,
];
const MAX_STEPS = 5;
const MAX_BACKGROUND = 4;

export function parseFeature(file: SourceFile): GherkinDocument {
  const parser = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher());
  return parser.parse(file.text);
}

const idOf = (tags: readonly Tag[]) => tags.find((t) => t.name.startsWith('@id:'))?.name.slice(4);

/** Every scenario in a feature, with the rule that holds it. */
export function scenariosOf(file: string, feature: Feature): ParsedScenario[] {
  const out: ParsedScenario[] = [];
  const add = (s: Scenario, rule: string | undefined, ruleTags: readonly Tag[]) =>
    out.push({
      file,
      feature: idOf(feature.tags) ?? feature.name,
      rule,
      name: s.name,
      line: s.location.line,
      backlog: [...feature.tags, ...ruleTags, ...s.tags].some((t) => t.name === '@backlog'),
    });
  for (const child of feature.children) {
    if (child.scenario) add(child.scenario, undefined, []);
    for (const rc of child.rule?.children ?? []) if (rc.scenario) add(rc.scenario, child.rule!.name, child.rule!.tags);
  }
  return out;
}

function checkSteps(where: string, steps: readonly Step[]): string[] {
  const issues: string[] = [];
  if (steps.length > MAX_STEPS) issues.push(`${where} has ${steps.length} steps. Use ${MAX_STEPS} at most`);
  const whens = steps.filter((s) => s.keywordType === 'Action').length;
  const thens = steps.filter((s) => s.keywordType === 'Outcome').length;
  if (whens !== 1 || thens !== 1) issues.push(`${where} needs one When and one Then`);
  return issues;
}

function checkText(where: string, text: string): string[] {
  return SOLUTION_WORDS.filter((w) => w.test(text)).map(
    (w) => `${where} names a solution (${String(text.match(w)?.[0])}). Say what someone can do and see`,
  );
}

/** Problems in a set of feature files: syntax, ids, tags, shape and solution words. */
export function checkFeatures(files: readonly SourceFile[]): string[] {
  const issues: string[] = [];
  const featureIds = new Map<string, string>();
  const scenarioIds = new Map<string, string>();
  const claim = (ids: Map<string, string>, id: string, where: string) => {
    const first = ids.get(id);
    if (first) issues.push(`${where}: @id:${id} is also used at ${first}`);
    else ids.set(id, where);
  };

  for (const file of files) {
    let doc: GherkinDocument;
    try {
      doc = parseFeature(file);
    } catch (err) {
      const lines = (err instanceof Error ? err.message : String(err))
        .split('\n')
        .filter((l) => l && l !== 'Parser errors:');
      issues.push(...lines.map((l) => `${file.path}: ${l}`));
      continue;
    }
    const at = (line: number) => `${file.path}:${line}`;
    for (const c of doc.comments) issues.push(`${at(c.location.line)}: no comments. Put it in the feature narrative`);
    const feature = doc.feature;
    if (!feature) {
      issues.push(`${file.path}: no Feature`);
      continue;
    }
    const allTags: Tag[] = [...feature.tags];
    const fid = idOf(feature.tags);
    if (!fid) issues.push(`${at(feature.location.line)}: the feature needs an @id:<kebab-case> tag`);
    else claim(featureIds, fid, at(feature.location.line));
    if (!feature.name.trim()) issues.push(`${at(feature.location.line)}: the feature needs a name`);
    issues.push(...checkText(at(feature.location.line), `${feature.name}\n${feature.description}`));

    const names = new Set<string>();
    const checkScenario = (s: Scenario) => {
      const where = at(s.location.line);
      allTags.push(...s.tags);
      if (!s.name.trim()) issues.push(`${where}: the scenario needs a name`);
      if (names.has(s.name)) issues.push(`${where}: another scenario in this feature is named "${s.name}"`);
      names.add(s.name);
      const sid = idOf(s.tags);
      if (sid) claim(scenarioIds, sid, where);
      if (s.examples.length === 0 && s.keyword.includes('Outline')) issues.push(`${where}: the outline needs Examples`);
      if (s.examples.length > 0 && !s.keyword.includes('Outline'))
        issues.push(`${where}: Examples belong to a Scenario Outline`);
      issues.push(...checkSteps(where, s.steps));
      issues.push(...checkText(where, [s.name, s.description, ...s.steps.map((st) => st.text)].join('\n')));
    };

    for (const child of feature.children) {
      if (child.background) {
        const bg = child.background;
        if (bg.steps.length > MAX_BACKGROUND)
          issues.push(`${at(bg.location.line)}: the Background has ${bg.steps.length} steps. Use ${MAX_BACKGROUND}`);
        issues.push(...checkText(at(bg.location.line), bg.steps.map((st) => st.text).join('\n')));
      }
      if (child.scenario) {
        issues.push(`${at(child.scenario.location.line)}: put the scenario in a Rule`);
        checkScenario(child.scenario);
      }
      if (child.rule) {
        const rule = child.rule;
        allTags.push(...rule.tags);
        const scenarios = rule.children.filter((rc) => rc.scenario);
        if (!scenarios.length) issues.push(`${at(rule.location.line)}: the rule needs a scenario`);
        issues.push(...checkText(at(rule.location.line), `${rule.name}\n${rule.description}`));
        for (const rc of rule.children) if (rc.scenario) checkScenario(rc.scenario);
      }
    }
    for (const tag of allTags)
      if (!ALLOWED_TAG.test(tag.name))
        issues.push(
          `${at(tag.location.line)}: ${tag.name} is not allowed. Use @id:<kebab-case>, @backlog or @long-running`,
        );
  }
  return issues;
}

/** Problems with the slice a PR builds: at most three new scenarios outside @backlog, all in one rule. */
export function checkSlice(before: readonly SourceFile[], after: readonly SourceFile[]): string[] {
  const key = (s: ParsedScenario) => `${s.feature}\u0000${s.name}`;
  const collect = (files: readonly SourceFile[]) =>
    files.flatMap((f) => {
      try {
        const feature = parseFeature(f).feature;
        return feature ? scenariosOf(f.path, feature) : [];
      } catch {
        return [];
      }
    });
  const old = new Map(collect(before).map((s) => [key(s), s]));
  const built = collect(after).filter((s) => !s.backlog && (old.get(key(s))?.backlog ?? true));
  const issues: string[] = [];
  if (built.length > 3)
    issues.push(`this PR builds ${built.length} scenarios. A slice is three at most: tag the others @backlog`);
  const rules = new Set(built.map((s) => `${s.feature} › ${s.rule ?? '(no rule)'}`));
  if (rules.size > 1)
    issues.push(`this PR builds scenarios of ${rules.size} rules: ${[...rules].join(', ')}. Pick one`);
  return issues;
}
