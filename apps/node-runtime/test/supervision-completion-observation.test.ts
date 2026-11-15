import type { RecordedWorkResponsibility, WorkforceAssignment } from "@lervo/agent-workforce";
import type { EventEnvelope } from "@lervo/schemas";
import { completionEvidenceId } from "@lervo/work-controller";
import { expect, it } from "vitest";
import { observeSupervisionCompletion } from "../src/supervision-completion-observation.js";

type Source = Parameters<typeof observeSupervisionCompletion>[0];

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const iso = (minute: number) => `2026-09-11T03:${String(minute).padStart(2, "0")}:00.000Z`;
const workstreamId = `wks_${"1".repeat(24)}`;
const assignmentId = `asn_${"2".repeat(24)}`;
const agentId = `agt_${"3".repeat(24)}`;
const leaseId = `lse_${"4".repeat(24)}`;
const runId = `run_${"5".repeat(32)}`;
const sessionId = `ses_${"6".repeat(32)}`;
const resultArtifactId = `art_${"7".repeat(64)}`;
const resultContentHash = hash("8");
const bindingEventId = `evt_${"9".repeat(32)}`;

interface Settlement {
  assignment: WorkforceAssignment;
  binding: RecordedWorkResponsibility;
  source: Source;
}

/** One exact settled completion: binding, managed run, governed preparation, then reconciliation. */
function settledCompletion(): Settlement {
  const responsibility = {
    assignmentId,
    assignmentRevision: 1,
    executorAgentId: agentId,
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: hash("a"),
    expectedPaths: ["src/save.ts"],
    acceptanceCriteria: ["The saved value is verified."],
    verificationSuiteIds: ["save.verified"],
  };
  const coordinate = {
    workstreamId,
    assignmentId,
    assignmentRevision: 1,
    agentId,
    leaseId,
    runId,
    sessionId,
    resultArtifactId,
    resultContentHash,
    preparedAt: iso(20),
  };
  const evidenceId = completionEvidenceId(coordinate);
  const event = (seq: number, type: string, occurredAt: string, payload: object) =>
    ({
      seq,
      eventId: `evt_${String(seq).repeat(32)}`,
      runId,
      sessionId,
      type,
      occurredAt,
      actor: { kind: "system" },
      payload,
    }) as unknown as EventEnvelope;
  const source = {
    workstream: { workstreamId },
    execution: {
      attempts: [
        { assignmentId, runId, terminalStatus: "completed", verificationStatus: "passed" },
      ],
    },
    events: [
      { ...event(1, "work.supervision.responsibility.bound", iso(1), {}), eventId: bindingEventId },
      event(2, "run.completed", iso(10), {
        resultDigest: resultContentHash,
        artifactIds: [resultArtifactId],
      }),
      event(3, "assignment.completion.prepared", iso(20), {
        completionEvidenceId: evidenceId,
        workstreamId,
        assignmentId,
        assignmentRevision: 1,
        agentId,
        leaseId,
        resultArtifactId,
        resultContentHash,
        verificationStatus: "passed",
        writingPublicationStatus: "allowed",
        preparedAt: iso(20),
      }),
      event(4, "assignment.completion.reconciled", iso(30), {
        completionEvidenceId: evidenceId,
        reconciliationCommandId: `gcr_${"b".repeat(24)}`,
        sourceRunId: runId,
        assignmentId,
        agentId,
        leaseId,
        resultArtifactId,
        resultContentHash,
        revision: 2,
        reconciledAt: iso(30),
      }),
    ],
  } as unknown as Source;
  const assignment = {
    assignmentId,
    status: "completed",
    revision: 2,
    assigneeAgentId: agentId,
    lease: null,
    failureCode: null,
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: hash("a"),
    requiredCapabilityHash: null,
    expectedPaths: ["src"],
    acceptanceCriteria: ["The saved value is verified."],
    verificationSuiteIds: ["save.verified"],
    resultArtifacts: [{ artifactId: resultArtifactId, contentHash: resultContentHash }],
    updatedAt: iso(30),
  } as unknown as WorkforceAssignment;
  const binding = {
    eventId: bindingEventId,
    responsibility,
  } as unknown as RecordedWorkResponsibility;
  return { assignment, binding, source };
}

function withRoleMigration(settlement: Settlement, change: Record<string, unknown> = {}) {
  const migration = {
    ...settlement.source.events[3]!,
    seq: 5,
    eventId: `evt_${"c".repeat(32)}`,
    type: "assignment.role.binding.changed",
    occurredAt: iso(40),
    payload: {
      assignmentId,
      revision: 3,
      roleId: "developer",
      previousRoleVersion: "1.0.0",
      previousRoleContractHash: hash("a"),
      previousRequiredCapabilityHash: null,
      roleVersion: "1.1.0",
      roleContractHash: hash("d"),
      requiredCapabilityHash: hash("e"),
    },
    ...change,
  } as EventEnvelope;
  settlement.source.events.push(migration);
  Object.assign(settlement.assignment, {
    revision: 3,
    roleVersion: "1.1.0",
    roleContractHash: hash("d"),
    requiredCapabilityHash: hash("e"),
    updatedAt: iso(40),
  });
  return settlement;
}

const observe = ({ source, assignment, binding }: Settlement) =>
  observeSupervisionCompletion(source, assignment, binding);
const reconciled = (settlement: Settlement) => settlement.source.events[3]!;

it("recognizes one exact settled completion of the bound revision", () => {
  expect(observe(settledCompletion())).toEqual({ assignmentRevision: 2 });
});

it("recognizes the completion through an exact administrative role-binding migration", () => {
  expect(observe(withRoleMigration(settledCompletion()))).toEqual({ assignmentRevision: 2 });
});

it.each<[string, (settlement: Settlement) => void]>([
  ["an unsettled assignment", ({ assignment }) => (assignment.status = "leased")],
  ["the bound revision itself", ({ assignment }) => (assignment.revision = 1)],
  ["another assignee", ({ assignment }) => (assignment.assigneeAgentId = `agt_${"f".repeat(24)}`)],
  ["a retained lease", ({ assignment }) => (assignment.lease = {} as WorkforceAssignment["lease"])],
  ["a failure code", ({ assignment }) => (assignment.failureCode = "verification_failed")],
  ["another role", ({ assignment }) => (assignment.roleId = "reviewer")],
  ["narrowed paths", ({ assignment }) => (assignment.expectedPaths = ["docs"])],
  ["changed acceptance", ({ assignment }) => (assignment.acceptanceCriteria = ["Other."])],
  ["changed verification", ({ assignment }) => (assignment.verificationSuiteIds = ["other"])],
  ["another result", ({ assignment }) => (assignment.resultArtifacts = [])],
  ["no managed attempt", ({ source }) => (source.execution.attempts.length = 0)],
  ["no reconciliation", ({ source }) => source.events.splice(3, 1)],
  [
    "a duplicate reconciliation",
    (settlement) => settlement.source.events.push({ ...reconciled(settlement), seq: 5 }),
  ],
  [
    "a binding recorded after preparation",
    ({ source }) => Object.assign(source.events[0]!, { seq: 3.5 }),
  ],
  [
    "a reconciliation before preparation",
    (settlement) => Object.assign(reconciled(settlement), { seq: 2.5 }),
  ],
  [
    "an agent reconciliation",
    (settlement) => Object.assign(reconciled(settlement), { actor: { kind: "agent" } }),
  ],
  [
    "a reconciliation dated before preparation",
    (settlement) => {
      Object.assign(reconciled(settlement), { occurredAt: iso(15) });
      Object.assign(reconciled(settlement).payload, { reconciledAt: iso(15) });
      settlement.assignment.updatedAt = iso(15);
    },
  ],
  [
    "a reconciliation time that differs from its event",
    (settlement) => Object.assign(reconciled(settlement).payload, { reconciledAt: iso(31) }),
  ],
  [
    "another reconciled lease",
    (settlement) =>
      Object.assign(reconciled(settlement).payload, { leaseId: `lse_${"0".repeat(24)}` }),
  ],
  [
    "another reconciled result",
    (settlement) => Object.assign(reconciled(settlement).payload, { resultContentHash: hash("0") }),
  ],
  ["a different completion time", ({ assignment }) => (assignment.updatedAt = iso(31))],
  ["a different role version", ({ assignment }) => (assignment.roleVersion = "2.0.0")],
])("rejects %s", (_name, change) => {
  const settlement = settledCompletion();
  change(settlement);
  expect(observe(settlement)).toBeNull();
});

it.each<[string, Record<string, unknown>]>([
  ["a non-system migration", { actor: { kind: "agent" } }],
  ["a migration before reconciliation", { seq: 3.5 }],
  ["a migration at another time", { occurredAt: iso(41) }],
])("rejects a role-binding chain with %s", (_name, change) => {
  expect(observe(withRoleMigration(settledCompletion(), change))).toBeNull();
});

it.each<[string, Record<string, unknown>]>([
  ["another previous role version", { previousRoleVersion: "0.9.0" }],
  ["another resulting capability", { requiredCapabilityHash: hash("0") }],
  ["a skipped revision", { revision: 4 }],
])("rejects a role-binding migration with %s", (_name, payload) => {
  const settlement = withRoleMigration(settledCompletion());
  Object.assign(settlement.source.events.at(-1)!.payload, payload);
  expect(observe(settlement)).toBeNull();
});

it("rejects a later revision without its role-binding migration", () => {
  const settlement = withRoleMigration(settledCompletion());
  settlement.source.events.pop();
  expect(observe(settlement)).toBeNull();
});
