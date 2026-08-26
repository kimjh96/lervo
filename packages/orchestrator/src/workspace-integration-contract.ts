import { createHash } from "node:crypto";

import type { WorkforceProvider, WorkspaceIntegrationAttempt } from "@lervo/agent-workforce";
import type {
  WorkspaceIntegrationStrategy,
  WorkspaceIntegrationTargetInspection,
  WorkspaceOwnershipMarker,
} from "@lervo/workspace-host";

const HASH = /^sha256:[a-f0-9]{64}$/u;

export interface WorkspaceIntegrationPlanSource {
  workspaceId: string;
  generation: number;
  workspaceRevision: number;
  workspaceContentHash: string;
  queueEntryId: string;
  assignmentId: string;
  headCommit: string;
  treeHash: string;
  commitIds: string[];
  changedPathSetDigest: string;
  strategy: WorkspaceIntegrationStrategy;
  integratingEventId: string;
  integratedEventId: string;
  conflictEventId: string;
  recoveryEventId: string;
}

export interface WorkspaceIntegrationCollision {
  pathDigest: string;
  workspaceIds: string[];
}

export interface WorkspaceIntegrationVerificationRequirement {
  suiteId: string;
  suiteHash: string;
}

export interface WorkspaceIntegrationPlan {
  schemaVersion: 1;
  planKind: "workspace_integration_candidate";
  planId: string;
  createdAt: string;
  repositoryRoot: string;
  integrationWorkspacePath: string;
  integrationWorkspaceId: string;
  integrationWorkspaceGeneration: number;
  integrationWorkspaceRevision: number;
  integrationWorkspaceContentHash: string;
  integrationAssignmentId: string;
  integrationAssignmentRevision: number;
  integratorAgentId: string;
  integratorWriterSessionId: string;
  leaseId: string;
  leaseGeneration: number;
  provider: Exclude<WorkforceProvider, "any">;
  integrationBaseCommit: string;
  integrationMarker: WorkspaceOwnershipMarker;
  targetRef: string;
  targetDigest: string;
  targetGeneration: number;
  targetBeforeCommit: string;
  targetInspection: WorkspaceIntegrationTargetInspection;
  sources: WorkspaceIntegrationPlanSource[];
  changedPathUnionDigest: string;
  changedPathUnionCount: number;
  collisions: WorkspaceIntegrationCollision[];
  verificationRequirements: WorkspaceIntegrationVerificationRequirement[];
  attempt: WorkspaceIntegrationAttempt;
  leaseEventId: string;
  candidateEventId: string;
  conflictAttemptEventId: string;
  advancingEventId: string;
  integratedAttemptEventId: string;
  rollbackEventId: string;
  idempotencyKey: string;
  advanceIdempotencyKey: string;
  resetIdempotencyKey: string;
  contentHash: string;
}

export function stableWorkspaceIntegrationJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableWorkspaceIntegrationJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableWorkspaceIntegrationJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function workspaceIntegrationDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableWorkspaceIntegrationJson(value)).digest("hex")}`;
}

export function workspaceIntegrationPlanContent(
  plan: Omit<WorkspaceIntegrationPlan, "contentHash" | "attempt"> & {
    attempt: Omit<WorkspaceIntegrationAttempt, "planContentHash">;
  },
): string {
  return workspaceIntegrationDigest(plan);
}

export function isWorkspaceIntegrationPlan(plan: WorkspaceIntegrationPlan): boolean {
  const { contentHash, attempt, ...content } = plan;
  const { planContentHash, ...attemptContent } = attempt;
  return (
    plan.schemaVersion === 1 &&
    plan.planKind === "workspace_integration_candidate" &&
    /^ipl_[a-f0-9]{24}$/u.test(plan.planId) &&
    HASH.test(contentHash) &&
    attempt.planContentHash === contentHash &&
    workspaceIntegrationPlanContent({ ...content, attempt: attemptContent }) === contentHash
  );
}
