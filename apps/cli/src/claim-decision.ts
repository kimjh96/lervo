// The core's claim decision (Lervo ADE coordination, "The claim contract"): a write inside the
// conversation's own lease answers at once; a new path widens the lease under the scheduler lock;
// a conflict denies with the holder and the message; any failure defers to the turn's end.
import {
  conversationLeaseCovers,
  conversationLeaseHolderWorkspaceIds,
  listWorkspaces,
  readAssignment,
  readOrCreateClaimPathKey,
  recordConversationClaimRefusals,
  widenConversationLease,
  type AgentWorkspace,
  type AssignmentPathRefusal,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { CLAIM_DEFERRED, type ClaimDecision, type WriteClaimRequest } from "./claim-contract.js";
import { claimWriterSessionId, type ClaimingConversation } from "./claim-conversation.js";
import { CLAIM_STORE_BUSY_MS, deferralCode, guardBeforeLock } from "./claim-deferral.js";
import { resolveClaimHolder } from "./claim-holder.js";
import { claimRefusalMessage } from "./claim-message.js";
import { groupHeldPaths, groupPaths, refusalGroups } from "./claim-refusal-groups.js";
import {
  locateClaimTargets,
  unignoredClaimPaths,
  type LocatedClaimTargets,
} from "./claim-targets.js";
import {
  conversationLeaseEventRecorder,
  conversationLeaseEventsWritable,
} from "./conversation-lease-events.js";
import { turnRefusals } from "./claim-turn-refusals.js";

const ALLOW: ClaimDecision = { decision: "allow" };

type ConversationClaimRequest = WriteClaimRequest<ClaimingConversation>;

function requestTurnRefusals(request: ConversationClaimRequest) {
  const { session } = request;
  return turnRefusals(session.repositoryRoot, session.provider, request.providerSessionId);
}

/** The detection an event names: a file tool's input, or a command's targets. */
function detectionOf(request: ConversationClaimRequest): "tool" | "shell" {
  return request.intent.toolClass === "shell" ? "shell" : "tool";
}

/** A group's held paths as an optional field: absent when the holder holds exactly its paths. */
function heldPathsField(group: readonly AssignmentPathRefusal[]) {
  const heldPaths = groupHeldPaths(group);
  return heldPaths === undefined ? {} : { heldPaths };
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
  const held = heldPathsField(named!);
  const holder = await resolveClaimHolder({ repositoryRoot, refusal: first, workspaces });
  return {
    decision: "deny",
    code: first.code,
    paths,
    ...held,
    holder,
    message: claimRefusalMessage({ code: first.code, paths, ...held, holder }),
    ...(others.length === 0
      ? {}
      : {
          otherRefusals: others.map((group) => ({
            code: group[0]!.code,
            paths: groupPaths(group),
            ...heldPathsField(group),
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
      recordedRefusals: await requestTurnRefusals(request),
      now,
    });
  } finally {
    await storage.close();
  }
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
    // Other conversations' changed paths are read under the scheduler lock. A lead whose lease
    // expired, or which another of its sessions holds, reacquires it there (`lease_regenerated`).
    const result = await widenConversationLease({
      repositoryRoot: session.repositoryRoot,
      assignmentId: session.assignmentId,
      agentId: session.agentId,
      sessionId,
      paths,
      mode: "request",
      detection: detectionOf(request),
      claimantWorkspaceId: session.workspaceId,
      regenerate: true,
      leaseHolderWorkspaceIds: conversationLeaseHolderWorkspaceIds(workspaces),
      recordedRefusals: await requestTurnRefusals(request),
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
      beforeLock: guardBeforeLock(request),
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
  // The lead's live lease keeps its writer session, whichever of the lead's sessions claims.
  const sessionId = claimWriterSessionId(session, assignment.lease, now);
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
