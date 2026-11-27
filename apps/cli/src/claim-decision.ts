// The core's claim decision (Lervo ADE coordination, "The claim contract"): a write inside the
// conversation's own lease answers at once; a new path widens the lease under the scheduler lock;
// a conflict denies with the holder and the message; any failure defers to the turn's end.
import {
  conversationChangedPathHolders,
  conversationLeaseCovers,
  conversationLeaseHolderWorkspaceIds,
  listWorkspaces,
  readAssignment,
  readOrCreateClaimPathKey,
  recordConversationClaimRefusals,
  widenConversationLease,
  type AgentWorkspace,
  type AssignmentPathRefusal,
  type RecordedClaimRefusal,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { CLAIM_DEFERRED, type ClaimDecision, type WriteClaimRequest } from "./claim-contract.js";
import type { ClaimingConversation } from "./claim-conversation.js";
import { resolveClaimHolder } from "./claim-holder.js";
import { ClaimLog } from "./claim-log.js";
import { claimRefusalMessage } from "./claim-message.js";
import {
  locateClaimTargets,
  unignoredClaimPaths,
  type LocatedClaimTargets,
} from "./claim-targets.js";
import {
  conversationLeaseEventRecorder,
  conversationLeaseEventsWritable,
} from "./conversation-lease-events.js";
import { terminalProviderSessionDigest } from "./terminal-event-coordinates.js";
import { sessionOpenTerminalTurn } from "./terminal-open-turns.js";

/** How long before the hook's deadline a claim stops rather than take the scheduler lock. */
const LOCK_MARGIN_MS = 500;

/**
 * How long a claim's event write waits for another writer of the event store. The write runs under
 * the scheduler lock, so a busy store defers the claim quickly instead of holding the lock.
 */
const CLAIM_STORE_BUSY_MS = 250;

const ALLOW: ClaimDecision = { decision: "allow" };

type ConversationClaimRequest = WriteClaimRequest<ClaimingConversation>;

/**
 * The refusals this session's turn already recorded, from the claim log since its prompt. Without
 * an open turn or a readable log there is nothing to skip, and every refusal records its event.
 */
async function turnRefusals(request: ConversationClaimRequest): Promise<RecordedClaimRefusal[]> {
  const { session } = request;
  const turn = await sessionOpenTerminalTurn(
    session.repositoryRoot,
    terminalProviderSessionDigest(session.provider, request.providerSessionId),
  ).catch(() => null);
  if (turn === null) return [];
  let log: ClaimLog | null;
  try {
    log = ClaimLog.openExisting();
  } catch {
    return [];
  }
  if (log === null) return [];
  try {
    return log
      .refusedSince(request.providerSessionId, turn.openedAt)
      .flatMap((entry) =>
        entry.paths.map((path) => ({ path, holderAgentId: entry.holder?.agentId ?? null })),
      );
  } catch {
    return [];
  } finally {
    log.close();
  }
}

/** The detection an event names: a file tool's input, or a command's targets. */
function detectionOf(request: ConversationClaimRequest): "tool" | "shell" {
  return request.intent.toolClass === "shell" ? "shell" : "tool";
}

/** A request's refusals grouped by code and holder, in order. */
function refusalGroups(refusals: readonly AssignmentPathRefusal[]): AssignmentPathRefusal[][] {
  const groups = new Map<string, AssignmentPathRefusal[]>();
  for (const refusal of refusals) {
    const key = [refusal.code, refusal.holderAgentId ?? "", refusal.holderWorkspaceId ?? ""].join(
      "\0",
    );
    groups.set(key, [...(groups.get(key) ?? []), refusal]);
  }
  return [...groups.values()];
}

function groupPaths(group: readonly AssignmentPathRefusal[]): string[] {
  return [...new Set(group.map((refusal) => refusal.path))];
}

/**
 * A denial named for the first refusal's code and holder, with every path that holder refused.
 * The write stops for every refusal, since one request claims all or none, and the claim log keeps
 * each other holder's group too, so the turn records one refusal event per holder.
 */
async function denial(
  repositoryRoot: string,
  refusals: readonly AssignmentPathRefusal[],
  workspaces: readonly AgentWorkspace[],
): Promise<ClaimDecision> {
  const [named, ...others] = refusalGroups(refusals);
  const first = named![0]!;
  const paths = groupPaths(named!);
  const holder = await resolveClaimHolder({ repositoryRoot, refusal: first, workspaces });
  return {
    decision: "deny",
    code: first.code,
    paths,
    holder,
    message: claimRefusalMessage({ code: first.code, paths, holder }),
    ...(others.length === 0
      ? {}
      : {
          otherRefusals: others.map((group) => ({
            code: group[0]!.code,
            paths: groupPaths(group),
            holder:
              group[0]!.holderAgentId === null
                ? null
                : { agentId: group[0]!.holderAgentId, workspaceId: group[0]!.holderWorkspaceId },
          })),
        }),
  };
}

/**
 * A target inside another checkout of the repository: the write would bypass both the claim and
 * the seal. The refusal records `assignment.claim.refused` when it can; a failed event never turns
 * it into an allowance.
 */
async function refuseOtherCheckout(
  request: ConversationClaimRequest,
  located: LocatedClaimTargets,
  now: Date,
): Promise<ClaimDecision> {
  const refusals = located.otherCheckout.map((path) => ({
    code: "path_outside_workspace" as const,
    path,
    holderAgentId: null,
    holderAssignmentId: null,
    holderWorkspaceId: null,
  }));
  await recordOtherCheckoutRefusals(request, refusals, now).catch(() => undefined);
  return denial(request.session.repositoryRoot, refusals, []);
}

async function recordOtherCheckoutRefusals(
  request: ConversationClaimRequest,
  refusals: readonly AssignmentPathRefusal[],
  now: Date,
): Promise<void> {
  const { repositoryRoot, assignmentId } = request.session;
  const storage = await openProjectStorage(repositoryRoot, { busyTimeoutMs: CLAIM_STORE_BUSY_MS });
  try {
    if (!conversationLeaseEventsWritable(storage)) return;
    await recordConversationClaimRefusals({
      signal: request.signal,
      assignment: await readAssignment(repositoryRoot, assignmentId),
      refusals,
      detection: detectionOf(request),
      claimPathKey: await readOrCreateClaimPathKey(repositoryRoot),
      recordEvent: conversationLeaseEventRecorder(storage),
      recordedRefusals: await turnRefusals(request),
      now,
    });
  } finally {
    await storage.close();
  }
}

/**
 * Checked immediately before the scheduler lock is taken: the hook has not answered without this
 * claim, and enough time remains to finish under the lock. Only then does the hook wait for it.
 */
function beforeLock(request: ConversationClaimRequest): () => void {
  return () => {
    request.signal.throwIfAborted();
    if (performance.now() > request.deadline - LOCK_MARGIN_MS)
      throw Object.assign(new Error("Too little time remains to claim under the lock."), {
        code: CLAIM_DEFERRED,
      });
    request.lockTaken();
  };
}

/** Widens the lease by `paths` under the scheduler lock and answers the outcome. */
async function widen(
  request: ConversationClaimRequest,
  sessionId: string,
  paths: readonly string[],
  now: Date,
): Promise<ClaimDecision> {
  const { session } = request;
  const storage = await openProjectStorage(session.repositoryRoot, {
    busyTimeoutMs: CLAIM_STORE_BUSY_MS,
  });
  // A widening whose event failed restores its bytes and reports only `deferred`; its cause, such
  // as a busy store, is the deferral's code.
  let eventFailure: unknown = null;
  const recordEvent = conversationLeaseEventRecorder(storage);
  try {
    // Below schema 16 no lease grows, and the conversation writes without claims.
    if (!conversationLeaseEventsWritable(storage)) return ALLOW;
    const workspaces = await listWorkspaces(session.repositoryRoot);
    const result = await widenConversationLease({
      repositoryRoot: session.repositoryRoot,
      assignmentId: session.assignmentId,
      agentId: session.agentId,
      sessionId,
      paths,
      mode: "request",
      detection: detectionOf(request),
      claimantWorkspaceId: session.workspaceId,
      changedPathHolders: conversationChangedPathHolders(workspaces, session.workspaceId),
      leaseHolderWorkspaceIds: conversationLeaseHolderWorkspaceIds(workspaces),
      recordedRefusals: await turnRefusals(request),
      claimPathKey: await readOrCreateClaimPathKey(session.repositoryRoot),
      recordEvent: (event) => {
        try {
          return recordEvent(event);
        } catch (error) {
          eventFailure = error;
          throw error;
        }
      },
      signal: request.signal,
      beforeLock: beforeLock(request),
      now,
    });
    if (result.refusals.length !== 0)
      return denial(session.repositoryRoot, result.refusals, workspaces);
    return result.status === "deferred"
      ? {
          decision: "defer",
          code: eventFailure === null ? CLAIM_DEFERRED : deferralCode(eventFailure),
        }
      : ALLOW;
  } finally {
    await storage.close();
  }
}

async function decide(request: ConversationClaimRequest, now: Date): Promise<ClaimDecision> {
  const { session } = request;
  const located = await locateClaimTargets(request.intent.targets, session.worktree);
  if (located.otherCheckout.length !== 0) return refuseOtherCheckout(request, located, now);
  if (located.inside.length === 0) return ALLOW;
  const assignment = await readAssignment(session.repositoryRoot, session.assignmentId);
  // A session without a launch record claims under the lease's own writer session.
  const sessionId = session.writerSessionId ?? assignment.lease?.sessionId ?? "";
  const covered = conversationLeaseCovers(assignment, {
    agentId: session.agentId,
    sessionId,
    paths: located.inside.map((target) => target.path),
    now,
  });
  if (covered) return ALLOW;
  const paths = await unignoredClaimPaths(session.worktree, located.inside);
  if (paths.length === 0) return ALLOW;
  return widen(request, sessionId, paths, now);
}

/** SQLite's `SQLITE_BUSY` and `SQLITE_LOCKED`: another writer held the store. */
const SQLITE_BUSY_CODES = new Set([5, 6]);

/**
 * A failure's code as a deferral carries it, such as `workforce_busy`, or `claim_deferred`. A
 * store another writer held past the claim's short wait is `workforce_busy` too.
 */
function deferralCode(error: unknown): string {
  const failure = error as { code?: unknown; errcode?: unknown } | null;
  if (typeof failure?.errcode === "number" && SQLITE_BUSY_CODES.has(failure.errcode & 0xff))
    return "workforce_busy";
  const code = failure?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code) ? code : CLAIM_DEFERRED;
}

/**
 * Decides a claim for a conversation whose coordination is active. A write inside the
 * conversation's own lease, with more than 30 seconds left, answers after reading only its
 * assignment. Any failure, such as `workforce_busy` after the workforce's retries, defers: the
 * write goes ahead and the turn's end claims it. It never throws.
 */
export async function decideClaim(
  request: ConversationClaimRequest,
  now: () => Date = () => new Date(),
): Promise<ClaimDecision> {
  try {
    return await decide(request, now());
  } catch (error) {
    return { decision: "defer", code: deferralCode(error) };
  }
}
