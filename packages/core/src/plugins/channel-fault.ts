import type { ChildProcess } from 'node:child_process';

/** ADR-0020: Node would convert a child's handle or act on its internal message inside core; refuse both. */
export function refuseChannelHandles(child: ChildProcess, onRefused: () => void): void {
  child.removeAllListeners('internalMessage');
  child.on('internalMessage', (_message: unknown, handle?: { close?: () => void }) => {
    handle?.close?.();
    onRefused();
  });
}

/** ADR-0020: a line that is not JSON on a child's channel, which Node parses before core sees a message. */
export function isPluginChannelFault(err: unknown): boolean {
  if (!(err instanceof SyntaxError) || !err.stack) return false;
  // Only the frames count: the message can carry any text. The header holds the message on its first line.
  const at = err.stack.indexOf(err.message);
  if (at === -1 || err.stack.slice(0, at).includes('\n')) return false;
  return /\n\s+at parseChannelMessages \(node:internal\/child_process\/serialization:\d+/.test(
    err.stack.slice(at + err.message.length),
  );
}
