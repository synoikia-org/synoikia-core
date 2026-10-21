const MAX_WORDS = 25;

/**
 * @typedef {object} Block
 * @property {number} line
 * @property {number} lastLine
 * @property {string} text
 * @property {boolean} label Headings and table rows are labels, not sentences: no length limit.
 */

/** Inline code and link targets are not prose. */
/** @param {string} text */
const stripInline = (text) =>
  text
    .replace(/`[^`]*`/g, 'Code')
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/<!--.*?-->/g, '')
    .replace(/https?:\/\/\S+/g, 'link');

/**
 * @param {string} text
 * @returns {Block[]}
 */
function markdownBlocks(text) {
  const lines = text.split('\n');
  /** @type {Block[]} */
  const blocks = [];
  /** @type {string | undefined} */
  let fence;
  let comment = false;
  /** @type {Block | undefined} */
  let para;
  const flush = () => {
    if (para) blocks.push(para);
    para = undefined;
  };
  let i = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const raw = /** @type {string} */ (lines[i]);
    const line = i + 1;
    const fenceMark = raw.match(/^\s*(`{3,}|~{3,})/)?.[1];
    if (fence) {
      if (fenceMark?.startsWith(fence)) fence = undefined;
      continue;
    }
    if (fenceMark) {
      flush();
      fence = fenceMark;
      continue;
    }
    if (comment || raw.trim().startsWith('<!--')) {
      comment = !raw.includes('-->');
      continue;
    }
    if (!raw.trim() || (/^\s{4,}\S/.test(raw) && !para)) {
      flush();
      continue;
    }
    if (/^\s*\|/.test(raw)) {
      flush();
      if (!/^\s*\|[\s:|-]+\|\s*$/.test(raw))
        for (const cell of raw.split('|').slice(1, -1)) blocks.push({ line, lastLine: line, text: cell, label: true });
      continue;
    }
    if (/^\s*#{1,6}\s/.test(raw)) {
      flush();
      blocks.push({ line, lastLine: line, text: raw.replace(/^\s*#+\s*/, ''), label: true });
      continue;
    }
    const item = raw.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item) {
      flush();
      para = { line, lastLine: line, text: item[1] ?? '', label: false };
      continue;
    }
    if (para) {
      para.text += ` ${raw.trim()}`;
      para.lastLine = line;
    } else para = { line, lastLine: line, text: raw.trim().replace(/^>\s*/, ''), label: false };
  }
  flush();
  return blocks;
}

/**
 * @param {string} text
 * @returns {Block[]}
 */
function featureBlocks(text) {
  return text.split('\n').flatMap((raw, i) => {
    const t = raw.trim();
    if (!t || t.startsWith('#') || t.startsWith('@')) return [];
    const label = t.startsWith('|') || /^[A-Za-z ]+:/.test(t);
    return [{ line: i + 1, lastLine: i + 1, text: t.replace(/^[A-Za-z ]+:\s*/, ''), label }];
  });
}

/** @param {string} sentence */
const words = (sentence) => sentence.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * Problems with the writing rules in one file. With `lines`, only blocks that touch those lines.
 * @param {string} file
 * @param {string} text
 * @param {ReadonlySet<number>} [lines]
 * @returns {string[]}
 */
export function checkProse(file, text, lines) {
  const blocks = file.endsWith('.feature') ? featureBlocks(text) : markdownBlocks(text);
  /** @type {string[]} */
  const issues = [];
  for (const block of blocks) {
    if (lines) {
      let touched = false;
      for (let l = block.line; l <= block.lastLine && !touched; l++) touched = lines.has(l);
      if (!touched) continue;
    }
    const prose = stripInline(block.text);
    const at = `${file}:${block.line}`;
    if (prose.includes(';')) issues.push(`${at}: no semicolons. Write two sentences`);
    if (prose.includes('—')) issues.push(`${at}: no em dashes. Write two sentences or use a colon`);
    if (block.label) continue;
    for (const sentence of prose.split(/(?<=[.!?:][*_)"'`]*)\s+(?=[\p{Lu}`*"([])/u)) {
      const n = words(sentence);
      if (n > MAX_WORDS) issues.push(`${at}: a sentence has ${n} words. Use ${MAX_WORDS} at most`);
    }
  }
  return issues;
}
