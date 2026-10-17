import { matchesAny } from './glob.js';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /(?:^|-)(?:\d{8}|\d{4}-\d{2}(?:-\d{2})?)(?:-|$)/;
/** A generated token: letters and two or more digits, like `abei82` or `a1b2c3d`. */
const GENERATED = /^(?=(?:[a-z]*\d){2})(?=.*[a-z])[a-z0-9]{5,}$/;

/** Problems with a branch name: `<component>/<two to four kebab-case words>`. */
export function checkBranch(name: string, components: readonly string[], ignore: readonly string[] = []): string[] {
  if (matchesAny(name, ignore)) return [];
  const parts = name.split('/');
  if (parts.length !== 2) return [`"${name}" is not <component>/<summary>`];
  const [component, summary] = parts as [string, string];
  const issues: string[] = [];
  if (!components.includes(component))
    issues.push(`"${component}" is not a component. Use one of: ${components.join(', ')}`);
  if (!KEBAB.test(summary)) issues.push(`"${summary}" is not lowercase kebab-case`);
  else {
    const words = summary.split('-');
    if (words.length < 2 || words.length > 4)
      issues.push(`"${summary}" has ${words.length} word${words.length === 1 ? '' : 's'}. Use two to four`);
    if (DATE.test(summary)) issues.push(`"${summary}" contains a date`);
    const generated = words.filter((w) => GENERATED.test(w));
    if (generated.length) issues.push(`"${generated.join('", "')}" looks generated. Say what changes`);
  }
  return issues;
}
