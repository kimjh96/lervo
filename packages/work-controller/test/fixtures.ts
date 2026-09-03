import type { WorkforceAssignment } from "@lervo/agent-workforce";
import type { EventEnvelope } from "@lervo/schemas";

export const projectId = "prj_fixture001";
export const workstreamId = "wks_111111111111111111111111";

export function assignment(
  suffix: string,
  input: Partial<WorkforceAssignment> = {},
): WorkforceAssignment {
  return {
    schemaVersion: 1,
    assignmentId: `asn_${suffix.repeat(24).slice(0, 24)}`,
    projectId,
    taskType: "implementation",
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"1".repeat(64)}`,
    status: "queued",
    priority: 50,
    dependencyIds: [],
    acceptanceCriteria: ["The task is verified."],
    verificationSuiteIds: ["project.quick"],
    approvalRequirements: [],
    expectedPaths: ["src/example.ts"],
    workstreamId,
    assigneeAgentId: null,
    lease: null,
    handoffs: [],
    resultArtifacts: [],
    failureCode: null,
    revision: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...input,
  };
}

export function event(
  sequence: number,
  type: string,
  runId: string,
  payload: Record<string, unknown>,
  provider?: "codex" | "claude",
): EventEnvelope {
  return {
    eventId: `evt_${String(sequence).padStart(24, "0")}`,
    projectId,
    runId,
    sessionId: `ses_${runId.slice(4).padEnd(24, "0").slice(0, 24)}`,
    seq: sequence,
    type,
    occurredAt: `2026-09-01T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    actor: provider === undefined ? { kind: "system" } : { kind: "provider", provider },
    schemaVersion: type.startsWith("work.") || type.startsWith("resource.") ? 2 : 1,
    policyVersion: `sha256:${"2".repeat(64)}`,
    payload,
    previousHash: sequence === 1 ? null : `sha256:${"3".repeat(64)}`,
    eventHash: `sha256:${"4".repeat(64)}`,
  } as EventEnvelope;
}

export function causalityPayload(input: {
  assignmentId: string;
  workId?: string;
  relationship?:
    | "root"
    | "retry"
    | "repair"
    | "subagent"
    | "verification"
    | "publication_evaluation"
    | "deliberation"
    | "improvement_evaluation";
  parentRunId?: string | null;
  retryOfRunId?: string | null;
  attemptOrdinal?: number;
}) {
  const relationship = input.relationship ?? "root";
  return {
    workId: input.workId ?? "wrk_111111111111111111111111",
    executionContractVersion: 1,
    relationship,
    parentRunId: relationship === "root" ? null : input.parentRunId!,
    retryOfRunId: relationship === "retry" ? input.retryOfRunId! : null,
    attemptOrdinal: input.attemptOrdinal ?? 1,
    workstreamId,
    assignmentId: input.assignmentId,
    agentId: "agt_111111111111111111111111",
  };
}
