import { createHash } from "node:crypto";

import type {
  WorkforceProvider,
  WorkspaceIntegrationQueueEntry,
  WorkspaceSealedResult,
} from "@lervo/agent-workforce";
import type { WorkspaceOwnershipMarker, WorkspaceResultInspection } from "@lervo/workspace-host";

const HASH = /^sha256:[a-f0-9]{64}$/u;

export interface WorkspaceSealPlan {
  schemaVersion: 1;
  planKind: "workspace_seal";
  planId: string;
  createdAt: string;
  repositoryRoot: string;
  workspacePath: string;
  workspaceId: string;
  workspaceContentHash: string;
  workspaceRevision: number;
  workspaceGeneration: number;
  assignmentId: string;
  assignmentRevision: number;
  agentId: string;
  leaseId: string;
  leaseGeneration: number;
  provider: Exclude<WorkforceProvider, "any">;
  writerSessionId: string;
  expectedPaths: string[];
  marker: WorkspaceOwnershipMarker;
  inspection: WorkspaceResultInspection;
  sealedResult: WorkspaceSealedResult;
  queueEntry: WorkspaceIntegrationQueueEntry;
  sealingEventId: string;
  sealedEventId: string;
  pendingEventId: string;
  contentHash: string;
}

export function stableWorkspaceSealJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableWorkspaceSealJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableWorkspaceSealJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function workspaceSealDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableWorkspaceSealJson(value)).digest("hex")}`;
}

export function workspaceSealPlanContent(plan: Omit<WorkspaceSealPlan, "contentHash">): string {
  return workspaceSealDigest(plan);
}

export function isWorkspaceSealPlan(plan: WorkspaceSealPlan): boolean {
  const { contentHash, ...content } = plan;
  return (
    plan.schemaVersion === 1 &&
    plan.planKind === "workspace_seal" &&
    /^wsl_[a-f0-9]{24}$/u.test(plan.planId) &&
    HASH.test(plan.workspaceContentHash) &&
    HASH.test(contentHash) &&
    workspaceSealPlanContent(content) === contentHash
  );
}

export function sameWorkspaceSealValue(left: unknown, right: unknown): boolean {
  return stableWorkspaceSealJson(left) === stableWorkspaceSealJson(right);
}
