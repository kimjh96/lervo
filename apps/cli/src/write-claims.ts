// Claims at first write (Lervo ADE coordination): the hosted session's pre-tool hook asks the
// conversation's claim for the paths a tool call writes. The core's coordination stage provides
// the claim; this leaf holds the request, the decision's deadline, and the hook's answer.
import { lstat } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";

import { claudeClaims } from "@lervo/adapter-claude/claims";
import type { HostedClaimAnswering, HostedClaimDecision } from "@lervo/adapter-contract";

import { type NewClaimLogEntry, recordClaimLogEntry } from "./claim-log.js";
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

/** Who holds a refused path: a live lease, another conversation's changed bytes, or a sealed change. */
export interface ClaimHolder {
  readonly agentId: string;
  readonly displayName: string;
  readonly roleName: string;
  readonly origin: "team" | "lervo";
  readonly workspaceId: string | null;
  readonly conversationTitle: string | null;
  readonly kind: "lease" | "changed" | "sealed_change";
  /** The lease's expiry, or null when no timer frees the path. */
  readonly until: string | null;
}

/**
 * The core's answer to a claim (Lervo ADE coordination, "The claim contract"). A refusal names
 * its code, the repository-relative paths, the holder, and the message the agent receives.
 */
export type ClaimDecision =
  | { readonly decision: "allow" }
  | {
      readonly decision: "deny";
      readonly code: string;
      readonly paths: readonly string[];
      readonly holder: ClaimHolder | null;
      readonly message: string;
    }
  | { readonly decision: "defer"; readonly code: string };

/** Claims a write for the session's conversation: the core's coordination stage. */
export type WriteClaimer = (request: WriteClaimRequest) => Promise<ClaimDecision>;

/** The provider hook's answer for the core's decision: a refusal carries its message. */
export function hookDecision(decision: ClaimDecision): HostedClaimDecision {
  return decision.decision === "deny"
    ? { decision: "deny", reason: decision.message }
    : { decision: decision.decision };
}

/** How long a claim may hold a tool call before the write goes ahead, claimed at the turn's end. */
export const CLAIM_DECISION_MS = 2000;

/** The claim before the core's coordination stage: every write goes ahead, as it did. */
export const unclaimed: WriteClaimer = () => Promise.resolve({ decision: "allow" });

/** The code a deferral carries when Lervo could not decide in time, or failed without one. */
export const CLAIM_DEFERRED = "claim_deferred";

/** How long the hook may spend recording a refusal or a deferral after deciding it. */
const CLAIM_RECORD_MS = 500;

/** The worktree that holds `directory`: the nearest folder with a `.git` entry, or null. */
async function worktreeRoot(directory: string): Promise<string | null> {
  for (let folder = directory; ; folder = dirname(folder)) {
    if ((await lstat(`${folder}${sep}.git`).catch(() => null)) !== null) return folder;
    if (dirname(folder) === folder) return null;
  }
}

/** `targets` relative to their worktree, with forward slashes; a target outside it is left out. */
async function repositoryPaths(
  targets: readonly { readonly path: string }[],
  workingDirectory: string,
): Promise<string[]> {
  const root = await worktreeRoot(workingDirectory);
  if (root === null) return [];
  return targets.flatMap(({ path }) => {
    const inside = relative(root, path);
    return inside === "" || inside.startsWith("..") ? [] : [inside.split(sep).join("/")];
  });
}

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
  /**
   * Records a refusal or a deferral in the claim log, which the conversation's room lines read.
   * An allowed write records nothing.
   */
  readonly record?: (entry: NewClaimLogEntry) => Promise<void>;
  readonly decisionMs?: number;
}): Promise<string> {
  const { hook, answering } = input;
  if (answering === null) return "{}\n";
  const workingDirectory = hook.workingDirectory ?? input.fallbackDirectory;
  const intent = answering.writeIntent(hook.toolName, hook.toolInput, workingDirectory);
  if (intent === null || (intent.targets.length === 0 && intent.detection !== "undetected"))
    return answering.claimAnswer({ decision: "allow" });
  let session: WritingSession | null = null;
  const decide = async (): Promise<ClaimDecision> => {
    session = await input.writing(hook.providerSessionId);
    if (session === null) return { decision: "allow" };
    return input.claim({
      workspaceId: session.workspaceId,
      agentId: session.agentId,
      providerSessionId: hook.providerSessionId,
      toolUseId: hook.toolUseId,
      intent,
    });
  };
  const deferred: ClaimDecision = { decision: "defer", code: CLAIM_DEFERRED };
  let timer: NodeJS.Timeout | undefined;
  const decision = await Promise.race([
    decide().catch(() => deferred),
    new Promise<ClaimDecision>((resolve) => {
      timer = setTimeout(() => resolve(deferred), input.decisionMs ?? CLAIM_DECISION_MS);
    }),
  ]).finally(() => clearTimeout(timer));
  const writing = session as WritingSession | null;
  if (decision.decision !== "allow" && writing !== null && input.record !== undefined) {
    const record = input.record;
    const entry = async (): Promise<NewClaimLogEntry> => ({
      workspaceId: writing.workspaceId,
      sessionId: hook.providerSessionId,
      toolUseId: hook.toolUseId,
      decision: decision.decision,
      code: decision.code,
      paths:
        decision.decision === "deny"
          ? [...decision.paths]
          : await repositoryPaths(intent.targets, workingDirectory),
      holder:
        decision.decision === "deny" && decision.holder !== null
          ? { agentId: decision.holder.agentId, workspaceId: decision.holder.workspaceId }
          : null,
    });
    // The log serves the conversation's lines; a write never waits long on it, nor fails for it.
    let recordTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      entry()
        .then(record)
        .catch(() => undefined),
      new Promise<void>((resolve) => (recordTimer = setTimeout(resolve, CLAIM_RECORD_MS))),
    ]).finally(() => clearTimeout(recordTimer));
  }
  return answering.claimAnswer(hookDecision(decision));
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

/**
 * The pre-tool hook's answer for a provider's session: Lervo's claim for its conversation, found
 * from the launch record, with refusals and deferrals kept in the claim log.
 */
export function answerClaimHook(
  hook: ParsedPreToolUseInput,
  provider: string,
  fallbackDirectory: string,
): Promise<string> {
  return answerPreToolUse({
    hook,
    answering: claimReading(provider),
    fallbackDirectory,
    writing: (session) => writingSessionOf(session),
    claim: unclaimed,
    record: (entry) => recordClaimLogEntry(entry),
  });
}
