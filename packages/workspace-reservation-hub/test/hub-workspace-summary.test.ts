import { describe, expect, it } from "vitest";

import type { AgentWorkspace, WorkspaceCoordinationEvent } from "@lervo/agent-workforce";
import { isHubWorkspaceSummary } from "@lervo/hub-sync";

import { hubWorkspaceSummaryFromEvent } from "../src/index.js";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const workspace: AgentWorkspace = {
  schemaVersion: 1,
  workspaceId: "wsp_0123456789abcdef01234567",
  generation: 1,
  repositoryInstanceId: "rpi_0123456789abcdef01234567",
  projectId: "prj_workspace_hub_01",
  assignmentId: "asn_0123456789abcdef01234567",
  agentId: "agt_0123456789abcdef01234567",
  leaseGeneration: 1,
  executionKind: "worker",
  host: { kind: "git", version: "1.0.0", nativeInstanceDigest: hash("1") },
  baseCommit: "a".repeat(40),
  integrationTargetDigest: hash("2"),
  creationPlanId: "wpl_0123456789abcdef01234567",
  markerHash: hash("3"),
  pathDigest: hash("4"),
  state: "provisioning",
  writerSession: null,
  sealedResult: null,
  integrationQueueEntryId: null,
  integrationEvidenceId: null,
  cleanupPlanId: null,
  recoveryReason: null,
  revision: 1,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};
const event: WorkspaceCoordinationEvent = {
  schemaVersion: 1,
  eventId: "evt_0123456789abcdef01234567",
  type: "agent.workspace.provisioned",
  occurredAt: workspace.createdAt,
  workspaceId: workspace.workspaceId,
  generation: workspace.generation,
  assignmentId: workspace.assignmentId,
  agentId: workspace.agentId,
  repositoryInstanceId: workspace.repositoryInstanceId,
  hostKind: workspace.host.kind,
  hostVersion: workspace.host.version,
  baseCommit: workspace.baseCommit,
  integrationTargetDigest: workspace.integrationTargetDigest,
  previousState: "absent",
  state: "provisioning",
  reasonCode: null,
  headCommit: null,
  treeHash: null,
  changedPathSetDigest: null,
  changedPathCount: null,
  integrationEvidenceId: null,
  cleanupPlanId: null,
  revision: 1,
};

describe("Hub workspace summary reconciliation", () => {
  it("projects a canonical local event into a valid path-private observational summary", () => {
    const summary = hubWorkspaceSummaryFromEvent({
      event,
      workspace,
      nodeId: "nod_node_0001",
      repositoryIdentityHash: hash("5"),
    });
    expect(isHubWorkspaceSummary(summary)).toBe(true);
    expect(summary).toMatchObject({
      state: "provisioning",
      processObservation: "unavailable",
      terminalCount: null,
    });
    expect(JSON.stringify(summary)).not.toContain("/Users/");
  });

  it("rejects an event from another workspace generation", () => {
    expect(() =>
      hubWorkspaceSummaryFromEvent({
        event: { ...event, generation: 2 },
        workspace,
        nodeId: "nod_node_0001",
        repositoryIdentityHash: hash("5"),
      }),
    ).toThrow("differs from its local workspace identity");
  });
});
