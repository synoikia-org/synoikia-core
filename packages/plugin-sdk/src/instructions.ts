import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

/** A manifest's `instructions` file (core design §2.2): Markdown the agent reads, checked the same way
 * by `synoikia-plugin check` and by core when it loads the plugin. */

/** Largest `instructions` file core accepts; a larger one fails the check, it is never truncated. */
export const INSTRUCTIONS_MAX_BYTES = 4096;

/** The text of an `instructions` file. Throws for a file over the cap, invalid UTF-8 or control characters. */
export function decodeInstructions(bytes: Uint8Array): string {
  if (bytes.byteLength > INSTRUCTIONS_MAX_BYTES)
    throw new Error(`instructions are ${bytes.byteLength} bytes; the limit is ${INSTRUCTIONS_MAX_BYTES}`);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new Error('instructions are not valid UTF-8');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
    throw new Error('instructions contain control characters');
  return text.trim();
}

/** Reads and decodes `file` in the package `dir`. Throws when it is missing, resolves outside `dir`, is
 * over the cap or is not UTF-8 text. */
export function readInstructionsFile(dir: string, file: string): string {
  const full = path.join(dir, file);
  if (!existsSync(full)) throw new Error('not found');
  if (!realpathSync(full).startsWith(realpathSync(dir) + path.sep))
    throw new Error('resolves outside the plugin directory');
  const stat = statSync(full);
  if (!stat.isFile()) throw new Error('is not a file');
  if (stat.size > INSTRUCTIONS_MAX_BYTES) throw new Error(`is over ${INSTRUCTIONS_MAX_BYTES} bytes`);
  return decodeInstructions(readFileSync(full));
}
