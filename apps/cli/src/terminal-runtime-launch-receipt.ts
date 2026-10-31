const receiptKey = Symbol.for("lervo.terminalHook.verifiedEntry");

/** A launcher receipt is process-local and consumed once, before hook input is read. */
export function consumeTerminalRuntimeLaunchReceipt(entry: string): boolean {
  const processState = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const verified = processState[receiptKey] === entry;
  delete processState[receiptKey];
  return verified;
}
