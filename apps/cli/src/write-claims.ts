// Claims at first write (Lervo ADE coordination): the hosted session's pre-tool hook asks the
// conversation's claim for the paths a tool call writes. The core's coordination stage provides
// the claim; this leaf holds the request, the decision's deadline, and the hook's answer.
import { claudeClaims } from "@lervo/adapter-claude/claims";
import type { HostedClaimAnswering, HostedClaimDecision } from "@lervo/adapter-contract";

import { hostedLaunchRecordsPath, latestHostedLaunchOfSession } from "./hosted-launch-records.js";
import type { ParsedPreToolUseInput } from "./terminal-hook-contract.js";

/** The conversation a hosted session writes for, from its launch record. */
export interface WritingSession {
  readonly workspaceId: string;
  readonly agentId: string;
}

/** A write a hosted agent's session is about to make. */
export interface WriteClaimRequest {
  readonly workspaceId: string;
  readonly agentId: string;
  readonly providerSessionId: string;
  readonly toolUseId: string | null;
  readonly intent: NonNullable<ReturnType<HostedClaimAnswering["writeIntent"]>>;
}

/**
 * Each hosted provider's claim reading. The hook runtime imports only these light entries, never
 * the adapters, which carry provider runtimes the hook must not load.
 */
const claimReaders: ReadonlyMap<string, HostedClaimAnswering> = new Map([["claude", claudeClaims]]);

/** `provider`'s claim reading, or null for a provider whose sessions claim nothing. */
export function claimReading(provider: string): HostedClaimAnswering | null {
  return claimReaders.get(provider) ?? null;
}

/** Claims a write for the session's conversation. */
export type WriteClaimer = (request: WriteClaimRequest) => Promise<HostedClaimDecision>;

/** How long a claim may hold a tool call before the write goes ahead, claimed at the turn's end. */
export const CLAIM_DECISION_MS = 2000;

/** The claim before the core's coordination stage: every write goes ahead, as it did. */
export const unclaimed: WriteClaimer = () => Promise.resolve({ decision: "allow" });

/**
 * What the pre-tool hook prints for `input`. Only the writing session of an agent's conversation
 * claims; a call that writes nothing claimable answers before reading any state. Finding the
 * session and the claim share {@link CLAIM_DECISION_MS}: past it, or on any failure, the answer
 * defers, so Lervo never stops the owner's work for itself.
 */
export async function answerPreToolUse(input: {
  readonly hook: ParsedPreToolUseInput;
  readonly answering: HostedClaimAnswering | null;
  readonly fallbackDirectory: string;
  /** The conversation the provider session writes for, or null when it writes for none. */
  readonly writing: (providerSessionId: string) => Promise<WritingSession | null>;
  readonly claim: WriteClaimer;
  readonly decisionMs?: number;
}): Promise<string> {
  const { hook, answering } = input;
  if (answering === null) return "{}\n";
  const intent = answering.writeIntent(
    hook.toolName,
    hook.toolInput,
    hook.workingDirectory ?? input.fallbackDirectory,
  );
  if (intent === null || (intent.targets.length === 0 && intent.detection !== "undetected"))
    return answering.claimAnswer({ decision: "allow" });
  const decide = async (): Promise<HostedClaimDecision> => {
    const session = await input.writing(hook.providerSessionId);
    if (session === null) return { decision: "allow" };
    return input.claim({
      workspaceId: session.workspaceId,
      agentId: session.agentId,
      providerSessionId: hook.providerSessionId,
      toolUseId: hook.toolUseId,
      intent,
    });
  };
  let timer: NodeJS.Timeout | undefined;
  const decision = await Promise.race([
    decide().catch((): HostedClaimDecision => ({ decision: "defer" })),
    new Promise<HostedClaimDecision>((resolve) => {
      timer = setTimeout(
        () => resolve({ decision: "defer" }),
        input.decisionMs ?? CLAIM_DECISION_MS,
      );
    }),
  ]).finally(() => clearTimeout(timer));
  return answering.claimAnswer(decision);
}

/**
 * The conversation a provider session writes for: the lead's session of a conversation started
 * with agents. A joined agent's session reads, and a session without an agent claims nothing.
 */
export async function writingSessionOf(
  providerSessionId: string,
  records = hostedLaunchRecordsPath(),
): Promise<WritingSession | null> {
  const record = await latestHostedLaunchOfSession(records, providerSessionId);
  return record?.agentId === undefined || record.access === "read"
    ? null
    : { workspaceId: record.workspaceId, agentId: record.agentId };
}
