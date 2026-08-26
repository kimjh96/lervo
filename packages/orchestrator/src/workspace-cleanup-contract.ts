import { createHash } from "node:crypto";

import type { WorkspaceCleanupObservation } from "@lervo/agent-workforce";
import type { WorkspaceOwnershipMarker } from "@lervo/workspace-host";

const HASH = /^sha256:[a-f0-9]{64}$/u;

export interface WorkspaceCleanupEvidence {
  status: "present";
  headCommit: string;
  treeHash: string;
  clean: boolean;
  gitOperationInProgress: boolean;
  markerMatched: boolean;
  processObservation: "quiescent" | "live" | "unavailable";
  nativeInstanceDigest: string;
  integrationTargetCommit: string;
  headReachableFromTarget: boolean;
  gitMetadataHash: string;
  dependentReferenceCount: number;
  childWorkspaceCount: number;
  reviewLinkCount: number;
  changedPathSetDigest: string;
  changedPathCount: number;
}

export interface WorkspaceCleanupPlan {
  schemaVersion: 1;
  planKind: "workspace_cleanup";
  planId: string;
  status: "ready" | "blocked";
  createdAt: string;
  repositoryRootDigest: string;
  workspacePathDigest: string;
  integrationTargetDigest: string;
  workspaceId: string;
  workspaceGeneration: number;
  workspaceRevision: number;
  workspaceContentHash: string;
  assignmentId: string;
  assignmentRevision: number;
  repositoryInstanceId: string;
  hostKind: "git" | "orca";
  hostVersion: string;
  marker: WorkspaceOwnershipMarker;
  workspaceBaseCommit: string;
  sealedHeadCommit: string;
  sealedTreeHash: string;
  integrationEvidenceId: string;
  integrationTargetCommit: string;
  hostEvidence: WorkspaceCleanupEvidence;
  observation: WorkspaceCleanupObservation;
  blockedReasons: string[];
  quiescenceSource: "host_process" | "lervo_writer_closure" | "unproven";
  operation: "remove_workspace_non_force";
  journalId: string;
  eligibleEventId: string;
  removingEventId: string;
  removedEventId: string;
  resetEventId: string;
  recoveryEventId: string;
  idempotencyKey: string;
  contentHash: string;
}

export interface WorkspaceCleanupCoordinates {
  repositoryRoot: string;
  workspacePath: string;
  integrationTargetRef: string;
}

export interface WorkspaceCleanupReceipt {
  schemaVersion: 1;
  status: "removed";
  planId: string;
  workspaceId: string;
  generation: number;
  integrationEvidenceId: string;
  removedAt: string;
  contentHash: string;
}

export function stableWorkspaceCleanupJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableWorkspaceCleanupJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableWorkspaceCleanupJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function workspaceCleanupDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableWorkspaceCleanupJson(value)).digest("hex")}`;
}

export function isWorkspaceCleanupPlan(plan: WorkspaceCleanupPlan): boolean {
  const { contentHash, ...content } = plan;
  return (
    plan.schemaVersion === 1 &&
    plan.planKind === "workspace_cleanup" &&
    /^wcp_[a-f0-9]{24}$/u.test(plan.planId) &&
    /^wcj_[a-f0-9]{24}$/u.test(plan.journalId) &&
    HASH.test(plan.repositoryRootDigest) &&
    HASH.test(plan.workspacePathDigest) &&
    HASH.test(plan.integrationTargetDigest) &&
    HASH.test(plan.workspaceContentHash) &&
    HASH.test(contentHash) &&
    workspaceCleanupDigest(content) === contentHash &&
    (plan.status === "ready" ? plan.blockedReasons.length === 0 : plan.blockedReasons.length > 0)
  );
}
