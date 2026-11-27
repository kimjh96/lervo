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
  type WriteClaimer,
  type WritingSession,
} from "./claim-contract.js";
import { decideClaim } from "./claim-decision.js";
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

/** How long a claim may hold a tool call before the write goes ahead, claimed at the turn's end. */
export const CLAIM_DECISION_MS = 2000;

/** The claim while the coordination stage's gate is closed: every write goes ahead, as it did. */
export const unclaimed: WriteClaimer = () => Promise.resolve({ decision: "allow" });

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
 * What the pre-tool hook prints for `input`. Only a session that writes for a conversation
 * claims; a call that writes nothing claimable answers before reading any state. Finding the
 * session and the claim share {@link CLAIM_DECISION_MS}: past it, or on any failure, the answer
 * defers, so Lervo never stops the owner's work for itself.
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
  readonly decisionMs?: number;
}): Promise<string> {
  const { hook, answering } = input;
  if (answering === null) return "{}\n";
  const workingDirectory = hook.workingDirectory ?? input.fallbackDirectory;
  const intent = answering.writeIntent(hook.toolName, hook.toolInput, workingDirectory);
  if (intent === null || (intent.targets.length === 0 && intent.detection !== "undetected"))
    return answering.claimAnswer({ decision: "allow" });
  const decisionMs = input.decisionMs ?? CLAIM_DECISION_MS;
  const deadline = performance.now() + decisionMs;
  let session: Session | null = null;
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
    });
  };
  const deferred: ClaimDecision = { decision: "defer", code: CLAIM_DEFERRED };
  let timer: NodeJS.Timeout | undefined;
  const decision = await Promise.race([
    decide().catch(() => deferred),
    new Promise<ClaimDecision>((resolve) => {
      timer = setTimeout(() => resolve(deferred), decisionMs);
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
 * The pre-tool hook's answer for a provider's session. While the coordination stage's gate is
 * open, the conversation the session writes for claims through the core's decision, with refusals
 * and deferrals kept in the claim log; while it is closed, no state is read and every write goes
 * ahead.
 */
export function answerClaimHook(
  hook: ParsedPreToolUseInput,
  provider: TerminalIntegrationProvider,
  fallbackDirectory: string,
  ports: ClaimingConversationPorts = defaultClaimingConversationPorts,
): Promise<string> {
  const workingDirectory = hook.workingDirectory ?? fallbackDirectory;
  const answer = {
    hook,
    answering: claimReading(provider),
    fallbackDirectory,
    record: (entry: NewClaimLogEntry) => recordClaimLogEntry(entry),
  };
  if (!ports.coordinationEnabled())
    return answerPreToolUse({ ...answer, writing: () => Promise.resolve(null), claim: unclaimed });
  return answerPreToolUse({
    ...answer,
    writing: (providerSessionId) =>
      findClaimingConversation({ provider, providerSessionId, workingDirectory }, ports),
    claim: (request) => decideClaim(request),
  });
}
