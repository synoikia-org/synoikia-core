import { matchesAny } from './glob.js';

export const SECURITY_LINE = /^Security audit: \S/m;

/** A ready PR that changes a security path states its audit on a line of its own. */
export function checkSecurityLine(
  pr: { draft: boolean; body: string | null },
  changed: readonly string[],
  paths: readonly string[],
): string[] {
  if (pr.draft) return [];
  const touched = changed.filter((f) => matchesAny(f, paths));
  if (!touched.length || SECURITY_LINE.test(pr.body ?? '')) return [];
  return [
    `this PR changes security paths (${touched.slice(0, 5).join(', ')}${touched.length > 5 ? ', …' : ''}). Add a line "Security audit: <boundary and findings>" or "Security audit: none. <why>" to its description`,
  ];
}
