/** ADR-0020: the faults a plugin child can raise inside Node's IPC code, before core sees its message. */
export function isPluginChannelFault(err: unknown): boolean {
  if (!(err instanceof Error) || !err.stack) return false;
  // Only the frames count: the message can carry any text.
  // The header, such as `Error [CODE]: message`, holds the message on its first line.
  const at = err.stack.indexOf(err.message);
  if (at === -1 || err.stack.slice(0, at).includes('\n')) return false;
  const frames = err.stack.slice(at + err.message.length);
  // A line that is not JSON on the channel.
  if (err instanceof SyntaxError)
    return /\n\s+at parseChannelMessages \(node:internal\/child_process\/serialization:\d+/.test(frames);
  // NODE_HANDLE_ACK or NODE_HANDLE_NACK from the child.
  return (
    (err as { code?: unknown }).code === 'ERR_INTERNAL_ASSERTION' &&
    /\n\s+at ChildProcess\.<anonymous> \(node:internal\/child_process:\d+/.test(frames)
  );
}
