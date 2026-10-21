/** Converts a path glob to a RegExp: `**` spans directories, `*` and `?` stay inside one segment. */
/**
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = /** @type {string} */ (glob[i]);
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      out += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/**
 * @param {string} file
 * @param {readonly string[]} globs
 */
export const matchesAny = (file, globs) => globs.some((g) => globToRegExp(g).test(file));
