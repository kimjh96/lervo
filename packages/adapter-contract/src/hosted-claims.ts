// Claims at first write (Lervo ADE coordination): what a provider's tool call is about to write,
// and Lervo's answer to it, which the provider's pre-tool hook carries back.

/** One path a write touches: a file, or a directory that covers every path below it. */
export interface HostedWriteTarget {
  /** Absolute, resolved against the session's working directory. */
  readonly path: string;
  readonly kind: "file" | "directory";
}

/**
 * A tool call's write intent: the tool's class, the targets found, and how they were found:
 * `exact` from a file tool's own field, `parsed` from a shell command, or `undetected` when an
 * operand could not be resolved, so the turn's end claims what changed.
 */
export interface HostedWriteIntent {
  readonly toolClass: "file" | "notebook" | "shell";
  readonly targets: readonly HostedWriteTarget[];
  readonly detection: "exact" | "parsed" | "undetected";
}

/**
 * Lervo's answer to a write intent. `allow`: the paths are the conversation's. `deny`: another
 * conversation holds one, and `reason` tells the agent who and what to do next. `defer`: Lervo
 * could not decide in time, so the write goes ahead and the turn's end claims it.
 */
export type HostedClaimDecision =
  { readonly decision: "allow" | "defer" } | { readonly decision: "deny"; readonly reason: string };

/** The longest refusal reason an answer carries to the agent. */
export const MAX_CLAIM_REASON_CHARACTERS = 2048;

/** A hosted-session adapter that reads its provider's tool calls and answers them for claims. */
export interface HostedClaimAnswering {
  /** The call's write intent, or null for a tool that writes nothing Lervo claims. */
  writeIntent(toolName: string, input: unknown, workingDirectory: string): HostedWriteIntent | null;
  /**
   * What the provider's pre-tool hook prints for `decision`. Only a refusal speaks: an allowed or
   * deferred call answers as no hook did, so the owner's own permission settings still decide.
   */
  claimAnswer(decision: HostedClaimDecision): string;
}

/** Whether `adapter` answers claims. */
export function answersClaims(adapter: object): adapter is HostedClaimAnswering {
  const candidate = adapter as Partial<HostedClaimAnswering>;
  return typeof candidate.writeIntent === "function" && typeof candidate.claimAnswer === "function";
}
