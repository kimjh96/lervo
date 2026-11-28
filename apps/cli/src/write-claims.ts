// Claims at first write (Lervo ADE coordination): the pre-tool hook asks the conversation's claim
// for the paths a tool call writes. The core's decision provides the claim; this leaf holds the
// request, the decision's deadline, and the hook's answer.
import { lstat } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";

import { claudeClaims } from "@lervo/adapter-claude/claims";
import type { HostedClaimAnswering, HostedClaimDecision } from "@lervo/adapter-contract";
import type { TerminalIntegrationProvider } from "@lervo/repository-knowledge";

import {
  defaultClaimingConversationPorts,
  findClaimingConversation,
  type ClaimingConversationPorts,
} from "./claim-conversation.js";
import {
  CLAIM_DEFERRED,
  type ClaimDecision,
  type ClaimRefusalGroup,
  type WriteClaimer,
  type WritingSession,
} from "./claim-contract.js";
import { decideClaim } from "./claim-decision.js";
import { deferralCode, unverifiedClaim } from "./claim-deferral.js";
import { type NewClaimLogEntry, recordClaimLogEntry } from "./claim-log.js";
import type { ParsedPreToolUseInput } from "./terminal-hook-contract.js";

/**
 * Each hosted provider's claim reading. The hook runtime imports only these light entries, never
 * the adapters, which carry provider runtimes the hook must not load.
 */
const claimReaders: ReadonlyMap<string, HostedClaimAnswering> = new Map([["claude", claudeClaims]]);

/** `provider`'s claim reading, or null for a provider whose sessions claim nothing. */
export function claimReading(provider: string): HostedClaimAnswering | null {
  return claimReaders.get(provider) ?? null;
}

/** The provider hook's answer for the core's decision: a refusal carries its message. */
export function hookDecision(decision: ClaimDecision): HostedClaimDecision {
  return decision.decision === "deny"
    ? { decision: "deny", reason: decision.message }
    : { decision: decision.decision };
}

/**
 * How long a claim may hold a tool call before Lervo refuses it as unverified. With the refusal's
 * record and a widening's settle it stays below the context server's 20-second run limit, so a
 * served claim is answered, never cut off by the server's exit.
 */
export const CLAIM_DECISION_MS = 12_000;

/**
 * How long after the hook started a claim may still decide, including a server the launcher
 * waited for first. With the record and settle after it, the answer stays below the provider's
 * 60-second claim hook timeout, so the provider never lets a write go ahead on its own timeout.
 */
export const CLAIM_HOOK_BUDGET_MS = 45_000;

/** How long the hook may spend recording a refusal or a deferral after deciding it. */
const CLAIM_RECORD_MS = 500;

/**
 * How long the hook process stays for a claim that took the scheduler lock, so exiting never
 * abandons a lock or the widened bytes without their event.
 */
export const CLAIM_SETTLE_MS = 5000;

/** `work`, or nothing once `milliseconds` passed. */
function bounded(work: Promise<unknown>, milliseconds: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    work.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => (timer = setTimeout(resolve, milliseconds))),
  ]).finally(() => clearTimeout(timer));
}

/** The claim log's entries for a decision: each other holder's first, the named one last. */
async function claimLogEntries(
  decision: Exclude<ClaimDecision, { decision: "allow" }>,
  base: Pick<NewClaimLogEntry, "workspaceId" | "sessionId" | "toolUseId">,
  deferredPaths: () => Promise<string[]>,
): Promise<NewClaimLogEntry[]> {
  if (decision.decision === "defer")
    return [
      {
        ...base,
        decision: "defer",
        code: decision.code,
        paths: await deferredPaths(),
        holder: null,
      },
    ];
  // `ofToolUse` reads a tool use's newest entry, so the one the message names goes last.
  const groups: ClaimRefusalGroup[] = [
    ...(decision.otherRefusals ?? []),
    {
      code: decision.code,
      paths: decision.paths,
      ...(decision.heldPaths === undefined ? {} : { heldPaths: decision.heldPaths }),
      holder:
        decision.holder === null
          ? null
          : { agentId: decision.holder.agentId, workspaceId: decision.holder.workspaceId },
    },
  ];
  return groups.map((group) => ({ ...base, decision: "deny", ...group, paths: [...group.paths] }));
}

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
 * What the pre-tool hook prints for `input`. Only a session that writes for a conversation
 * claims; a call that writes nothing claimable answers before reading any state. Finding the
 * session and the claim share {@link CLAIM_DECISION_MS}. Past it, or on any failure, the write is
 * refused as unverified with its cause: Lervo never lets a write it could not check pass as
 * checked, and the refusal tells the agent to retry.
 */
export async function answerPreToolUse<Session extends WritingSession>(input: {
  readonly hook: ParsedPreToolUseInput;
  readonly answering: HostedClaimAnswering | null;
  readonly fallbackDirectory: string;
  /** The conversation the provider session writes for, or null when it writes for none. */
  readonly writing: (providerSessionId: string) => Promise<Session | null>;
  readonly claim: WriteClaimer<Session>;
  /**
   * Records a refusal or a deferral in the claim log, which the conversation's room lines read.
   * An allowed write records nothing.
   */
  readonly record?: (entry: NewClaimLogEntry) => Promise<void>;
  /**
   * Receives a claim's work once it takes the scheduler lock, bounded by `settleMs`. The hook
   * waits for it before its process exits, and a context server drains it before the next request.
   */
  readonly trackWork?: (work: Promise<unknown>) => void;
  readonly decisionMs?: number;
  readonly settleMs?: number;
  /** When the hook started, on the `performance.now()` clock; the claim's budget counts from it. */
  readonly hookStartedAt?: number;
}): Promise<string> {
  const { hook, answering } = input;
  if (answering === null) return "{}\n";
  const workingDirectory = hook.workingDirectory ?? input.fallbackDirectory;
  const intent = answering.writeIntent(hook.toolName, hook.toolInput, workingDirectory);
  if (intent === null || (intent.targets.length === 0 && intent.detection !== "undetected"))
    return answering.claimAnswer({ decision: "allow" });
  const decisionMs = Math.max(
    0,
    Math.min(
      input.decisionMs ?? CLAIM_DECISION_MS,
      (input.hookStartedAt ?? performance.now()) + CLAIM_HOOK_BUDGET_MS - performance.now(),
    ),
  );
  const deadline = performance.now() + decisionMs;
  const answered = new AbortController();
  let session: Session | null = null;
  let deciding: Promise<ClaimDecision> | undefined;
  const decide = async (): Promise<ClaimDecision> => {
    const found = await input.writing(hook.providerSessionId);
    session = found;
    if (found === null) return { decision: "allow" };
    return input.claim({
      workspaceId: found.workspaceId,
      agentId: found.agentId,
      providerSessionId: hook.providerSessionId,
      toolUseId: hook.toolUseId,
      intent,
      session: found,
      deadline,
      signal: answered.signal,
      lockTaken: () => input.trackWork?.(bounded(deciding!, input.settleMs ?? CLAIM_SETTLE_MS)),
    });
  };
  const deferred: ClaimDecision = { decision: "defer", code: CLAIM_DEFERRED };
  let timer: NodeJS.Timeout | undefined;
  deciding = decide().catch((error: unknown): ClaimDecision => ({
    decision: "defer",
    code: deferralCode(error),
  }));
  const decided = await Promise.race([
    deciding,
    new Promise<ClaimDecision>((resolve) => {
      timer = setTimeout(() => {
        answered.abort(
          Object.assign(new Error("The claim was not decided in time."), {
            code: CLAIM_DEFERRED,
          }),
        );
        resolve(deferred);
      }, decisionMs);
    }),
  ]).finally(() => clearTimeout(timer));
  const decision =
    decided.decision === "defer"
      ? unverifiedClaim(
          decided.code,
          await repositoryPaths(intent.targets, workingDirectory).catch(() => []),
        )
      : decided;
  const writing = session as WritingSession | null;
  if (decision.decision !== "allow" && writing !== null && input.record !== undefined) {
    const record = input.record;
    const base = {
      workspaceId: writing.workspaceId,
      sessionId: hook.providerSessionId,
      toolUseId: hook.toolUseId,
    };
    // The log serves the conversation's lines and the turn's one refusal event per holder; a write
    // never waits long on it, nor fails for it. Parallel hooks of one turn may both miss each
    // other's entry and record a second event, which the log's readers tolerate.
    const recordAll = async () => {
      for (const entry of await claimLogEntries(decision, base, () =>
        repositoryPaths(intent.targets, workingDirectory),
      ))
        await record(entry);
    };
    await bounded(recordAll(), CLAIM_RECORD_MS);
  }
  return answering.claimAnswer(hookDecision(decision));
}

/**
 * The pre-tool hook's answer for a provider's session: the conversation the session writes for
 * claims through the core's decision while the repository's coordination gate is open, with
 * refusals and deferrals kept in the claim log. `trackWork` receives a claim that took the
 * scheduler lock, which the caller lets finish before its process exits.
 */
export function answerClaimHook(
  hook: ParsedPreToolUseInput,
  provider: TerminalIntegrationProvider,
  fallbackDirectory: string,
  options: {
    readonly ports?: ClaimingConversationPorts;
    readonly trackWork?: (work: Promise<unknown>) => void;
    readonly hookStartedAt?: number;
  } = {},
): Promise<string> {
  const workingDirectory = hook.workingDirectory ?? fallbackDirectory;
  const ports = options.ports ?? defaultClaimingConversationPorts;
  return answerPreToolUse({
    hook,
    answering: claimReading(provider),
    fallbackDirectory,
    record: (entry: NewClaimLogEntry) => recordClaimLogEntry(entry),
    ...(options.trackWork === undefined ? {} : { trackWork: options.trackWork }),
    ...(options.hookStartedAt === undefined ? {} : { hookStartedAt: options.hookStartedAt }),
    writing: (providerSessionId) =>
      findClaimingConversation({ provider, providerSessionId, workingDirectory }, ports),
    claim: (request) => decideClaim(request),
  });
}

/**
 * The claim hook's answer when the hook itself failed before a decision, such as on input it could
 * not read: the write is refused as unverified with `cause`, never let through unchecked.
 */
export function unverifiedClaimAnswer(provider: string, cause: string): string {
  const answering = claimReading(provider);
  return answering === null
    ? "{}\n"
    : answering.claimAnswer(hookDecision(unverifiedClaim(cause, [])));
}
