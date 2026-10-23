/** ADR-0020: core and a plugin exchange one JSON value on each line of a plain pipe. */
export const MAX_FRAME_BYTES = 64 * 1024 * 1024;

/** The file descriptor of the message pipe in the plugin child. */
export const CHANNEL_FD = 3;

export function encodeFrame(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

/** One line of the pipe: its JSON value, or `ok: false` when the line is not JSON. */
export type Frame = { ok: true; value: unknown } | { ok: false };

/** Splits a byte stream into frames. Returns null once a line passes `maxBytes`: the stream is then broken. */
export function createFrameReader(maxBytes = MAX_FRAME_BYTES): (chunk: Buffer) => Frame[] | null {
  let parts: Buffer[] = [];
  let size = 0;
  return (chunk) => {
    const frames: Frame[] = [];
    let start = 0;
    for (let end = chunk.indexOf(10); end !== -1; end = chunk.indexOf(10, start)) {
      const piece = chunk.subarray(start, end);
      start = end + 1;
      // An empty line carries nothing: skip it without parsing.
      if (piece.length === 0 && size === 0) continue;
      if (size + piece.length > maxBytes) return null;
      const line = Buffer.concat([...parts, piece]).toString('utf8');
      parts = [];
      size = 0;
      try {
        frames.push({ ok: true, value: JSON.parse(line) as unknown });
      } catch {
        frames.push({ ok: false });
      }
    }
    const rest = chunk.subarray(start);
    if (size + rest.length > maxBytes) return null;
    if (rest.length > 0) {
      parts.push(Buffer.from(rest));
      size += rest.length;
    }
    return frames;
  };
}
