import type {
  OperatingActionPlanV1,
  OperatingAdmissionSnapshotV1,
  OperatingMandateV1,
  WorkerReadinessObservationV1,
  WorkResponsibilityV1,
} from "@lervo/application-contract";
import {
  operatingContractHash,
  operatingEffectAdmissionHash,
  workerReadinessKinds,
} from "../src/index.js";

export const hash = (letter = "a") => `sha256:${letter.repeat(64)}`;
export const now = "2026-09-11T03:00:00.000Z";
export const owner = `agt_${"a".repeat(24)}`;
export function mandate(): OperatingMandateV1 {
  return {
    schemaVersion: 1,
    mandateId: "mandate.project",
    version: 1,
    appointingAuthorityId: "user.founder",
    ownerAgentId: owner,
    projectIds: [`prj_${"a".repeat(16)}`],
    teamIds: ["team_project01"],
    actionKinds: [
      "allocate_existing",
      "dispatch",
      "hire_worker",
      "revise_responsibility",
      "retry_attempt",
    ],
    roleIds: ["developer"],
    capabilityCeiling: ["repository.read", "repository.write"],
    pathRoots: ["src", "docs"],
    providers: ["fixture-provider"],
    maximumWorkers: 4,
    maximumConcurrentAttempts: 2,
    maximumAttemptsPerAssignment: 3,
    maximumAttemptTokens: 1000,
    maximumAggregateTokens: 10000,
    maximumDeadlineMs: 3600000,
    issuedAt: "2026-09-11T00:00:00.000Z",
    expiresAt: "2026-09-12T00:00:00.000Z",
    revocationCoordinate: "mandate.project.revocation",
  };
}
export function plan(): OperatingActionPlanV1 {
  return {
    schemaVersion: 1,
    supervisionId: "supervision.project",
    projectId: mandate().projectIds[0]!,
    teamId: "team_project01",
    workstreamId: `wks_${"a".repeat(24)}`,
    ownerAgentId: owner,
    mandateHash: operatingContractHash(mandate()),
    sourceRevisionDigest: hash(),
    graphHash: hash("b"),
    causationEventIds: [`evt_${"a".repeat(32)}`],
    actionKind: "dispatch",
    effectContract: "assignment.dispatch.v1",
    effectHash: hash("c"),
    rationaleArtifactHash: hash("d"),
    responsibilityArtifactHash: hash("e"),
    roleId: "developer",
    requiredCapabilities: ["repository.write"],
    expectedPaths: ["src/app.ts"],
    provider: "fixture-provider",
    addedWorkers: 0,
    addedAssignments: 1,
    concurrentAttempts: 1,
    attemptNumber: 1,
    reservedTokens: 1000,
    deadline: "2026-09-11T03:30:00.000Z",
  };
}
export function snapshot(): OperatingAdmissionSnapshotV1 {
  return {
    observedAt: now,
    sourceRevisionDigest: hash(),
    graphHash: hash("b"),
    installedMandateHash: operatingContractHash(mandate()),
    installationReviewHash: hash("f"),
    revocationCoordinate: mandate().revocationCoordinate,
    revoked: false,
    ancestryValid: true,
    historyValid: true,
    activeWorkers: 1,
    activeAttempts: 0,
    assignmentCount: 1,
    observedAggregateTokens: 2000,
    reservedAggregateTokens: 0,
    liveResponsibilityLease: false,
    resourceAdmission: "within",
    effectAdmissionHash: operatingEffectAdmissionHash(plan()),
    effectMappings: [
      { actionKind: "dispatch", contract: "assignment.dispatch.v1" },
      { actionKind: "revise_responsibility", contract: "responsibility.revise.v1" },
    ],
  };
}
export function responsibility(): WorkResponsibilityV1 {
  return {
    schemaVersion: 1,
    assignmentId: `asn_${"a".repeat(24)}`,
    assignmentRevision: 1,
    executorAgentId: `agt_${"b".repeat(24)}`,
    reviewerAgentId: owner,
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: hash(),
    taskPurpose: "Correct the save failure.",
    deliverables: ["A verified fix."],
    acceptanceCriteria: ["The document persists after restart."],
    decisionLatitude: ["Change the persistence adapter."],
    expectedPaths: ["src/save.ts"],
    requiredCapabilities: ["repository.write"],
    verificationSuiteIds: ["save.restart"],
    handoffRecipientIds: [owner],
    startDeadline: "2026-09-11T03:05:00.000Z",
    progressDeadline: "2026-09-11T03:15:00.000Z",
    completionDeadline: "2026-09-11T03:30:00.000Z",
    predecessorBindingHash: null,
  };
}
export function readiness(): WorkerReadinessObservationV1 {
  const task = responsibility();
  return {
    schemaVersion: 1,
    sourceRevisionDigest: hash(),
    responsibilityArtifactHash: operatingContractHash(task),
    agentId: task.executorAgentId,
    roleId: task.roleId,
    roleVersion: task.roleVersion,
    roleContractHash: task.roleContractHash,
    observedAt: now,
    validUntil: "2026-09-11T03:01:00.000Z",
    checks: workerReadinessKinds.map((kind) => ({ kind, status: "passed", evidenceHash: hash() })),
  };
}
