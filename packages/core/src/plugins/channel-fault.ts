/** ADR-0020: the faults a plugin child can raise inside Node's IPC code, before core sees its message. */
export function isPluginChannelFault(err: unknown): boolean {
  if (!(err instanceof Error) || !err.stack) return false;
  // A line that is not JSON on the channel.
  if (err instanceof SyntaxError)
    return err.stack.includes('at parseChannelMessages (node:internal/child_process/serialization');
  // NODE_HANDLE_ACK or NODE_HANDLE_NACK from the child.
  return (
    (err as { code?: unknown }).code === 'ERR_INTERNAL_ASSERTION' &&
    /at ChildProcess\.<anonymous> \(node:internal\/child_process:/.test(err.stack)
  );
}
