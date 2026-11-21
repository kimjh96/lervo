import type { WorkResponsibilityV1 } from "@lervo/application-contract";
import { FileSystemCas } from "@lervo/cas";
import { writingContractForLanguage } from "@lervo/core";
import { canonicalJson } from "@lervo/event-contract";
import { operatingContractHash } from "@lervo/work-controller";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { nativeAssignmentCompletion } from "../src/supervision-native-completion.js";
import type { NativeOwnerPlanInput } from "../src/supervision-native-plans.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const hash = (letter: string) => `sha256:${letter.repeat(64)}`;
const at = (seconds: number) => new Date(Date.parse("2026-09-11T03:00:00.000Z") + seconds * 1000);
const iso = (seconds: number) => at(seconds).toISOString();
const assignmentId = `asn_${"a".repeat(24)}`;
const ownerAgentId = `agt_${"c".repeat(24)}`;
const terminalEventId = `evt_${"e".repeat(32)}`;
const result = "The saved value was updated and verification passed.\n";

interface Scenario {
  now: number;
  leaseExpiresAt?: number;
  completionDeadline?: number;
  planDeadline?: number;
  checks?: "passed" | "failed";
  rejection?: string;
  terminal?: { type: string; occurredAt: number } | null;
}

async function completion(scenario: Scenario) {
  const root = await mkdtemp(join(tmpdir(), "lervo-native-completion-"));
  roots.push(root);
  const artifacts = await FileSystemCas.open(root);
  const contentHash = (await artifacts.put(result)).contentHash;
  const rationaleArtifactHash = (
    await artifacts.put(canonicalJson(scenario.rejection ?? "The owner judged the exact result."))
  ).contentHash;
  const writingContract = writingContractForLanguage("en");
  const responsibility: WorkResponsibilityV1 = {
    schemaVersion: 1,
    assignmentId,
    assignmentRevision: 1,
    executorAgentId: `agt_${"b".repeat(24)}`,
    reviewerAgentId: ownerAgentId,
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: hash("1"),
    taskPurpose: "Correct the saved value.",
    deliverables: ["A verified saved value."],
    acceptanceCriteria: ["The saved value is verified."],
    decisionLatitude: ["Change only src/save.ts."],
    expectedPaths: ["src/save.ts"],
    requiredCapabilities: ["filesystem.write"],
    verificationSuiteIds: ["save.verified"],
    handoffRecipientIds: [ownerAgentId],
    startDeadline: iso(60),
    progressDeadline: iso(120),
    completionDeadline: iso(scenario.completionDeadline ?? 1200),
    predecessorBindingHash: null,
  };
  const assignment = {
    assignmentId,
    roleId: "developer",
    status: "leased",
    revision: 2,
    lease: {
      leaseId: `lse_${"d".repeat(24)}`,
      acquiredAt: iso(0),
      expiresAt: iso(scenario.leaseExpiresAt ?? 900),
    },
  };
  const terminal =
    scenario.terminal === undefined ? { type: "run.completed", occurredAt: 30 } : scenario.terminal;
  const input = {
    storage: {
      artifacts,
      events: {
        get: (eventId: string) =>
          terminal === null || eventId !== terminalEventId
            ? null
            : { eventId, type: terminal.type, occurredAt: iso(terminal.occurredAt) },
      },
    },
    facts: {
      tasks: {
        assignments: [
          {
            assignmentId,
            revision: 2,
            terminalEventId,
            artifactHashes: [contentHash],
            responsibilityArtifactHash: hash("2"),
            acceptanceHash: hash("3"),
            verification: [{ eventId: `evt_${"f".repeat(32)}` }],
          },
        ],
      },
      assignments: [assignment],
      responsibilities: [{ assignmentId, binding: { responsibility } }],
      roles: [],
      writingContract,
    },
    base: {
      projectId: `prj_${"9".repeat(16)}`,
      ownerAgentId,
      deadline: iso(scenario.planDeadline ?? 3600),
    },
    reasoningPlanHash: hash("4"),
    resultArtifactHash: hash("5"),
    now: () => iso(scenario.now),
  } as unknown as NativeOwnerPlanInput;
  const checks = writingContract.verification.semanticChecks
    .filter((check) => check.required)
    .map((check) => ({
      checkId: check.checkId,
      status: scenario.checks ?? "passed",
      violationCount: scenario.checks === "failed" ? 1 : 0,
    }));
  const output = await nativeAssignmentCompletion(
    input,
    {
      assignmentId,
      writingPolicyId: writingContract.writingPolicyId,
      checks,
    },
    rationaleArtifactHash,
  );
  return { output, artifacts, assignment, contentHash, rationaleArtifactHash };
}

async function readText(artifacts: FileSystemCas, contentHash: string) {
  return new TextDecoder().decode(
    await artifacts.get(`lervo-cas://sha256/${contentHash.slice(7)}`),
  );
}

it("prepares an on-time accepted writing verdict as a v1 completion", async () => {
  const { output, artifacts, assignment, contentHash, rationaleArtifactHash } = await completion({
    now: 60,
  });
  expect(output.fields.effectContract).toBe("work.assignment_completion.v1");
  expect(output.effect).toMatchObject({
    schemaVersion: 1,
    kind: "work.assignment_completion",
    expectedAssignmentHash: operatingContractHash(assignment),
    reasoningPlanHash: hash("4"),
    reasoningResultHash: hash("5"),
    preparedAt: iso(60),
    rationaleArtifactHash,
  });
  expect(output.effect).not.toHaveProperty("settlementDeadline");
  const writing = JSON.parse(
    await readText(
      artifacts,
      (output.effect as { writingArtifactHash: string }).writingArtifactHash,
    ),
  );
  expect(writing.publication).toMatchObject({
    status: "allowed",
    semanticEvaluationStatus: "completed",
  });
  // ADR-0608: the decision carries no result hash; Lervo binds the single returned result.
  expect(writing.artifact.contentHash).toBe(contentHash);
});

it("turns a failed writing judgement into a rework review instead of a completion", async () => {
  const rejection = "The result does not explain the saved value.";
  const { output, artifacts, contentHash } = await completion({
    now: 60,
    checks: "failed",
    rejection,
  });
  expect(output.fields.effectContract).toBe("work.artifact_review.v1");
  expect(output.effect).toMatchObject({
    schemaVersion: 1,
    kind: "work.artifact_review",
    assignmentId,
    assignmentRevision: 2,
    terminalEventId,
    reviewerAgentId: ownerAgentId,
    responsibilityArtifactHash: hash("2"),
    acceptanceHash: hash("3"),
    artifactHashes: [contentHash],
    verificationEventIds: [`evt_${"f".repeat(32)}`],
    verdict: "rework",
  });
  const rationale = JSON.parse(
    await readText(
      artifacts,
      (output.effect as { rationaleArtifactHash: string }).rationaleArtifactHash,
    ),
  ) as string;
  expect(rationale).toContain("rejected this exact returned result");
  expect(rationale).toContain(rejection);
  expect(rationale).toContain('"status":"failed"');
  expect(rationale).toContain(`Reasoning result: ${hash("5")}`);
});

it("refuses a rejected writing judgement without a recorded rationale", async () => {
  await expect(completion({ now: 60, checks: "failed", rejection: "  " })).rejects.toThrow(
    /no recorded rationale/u,
  );
});

it.each([
  { name: "lease expiry", now: 901, planDeadline: 3600, settlement: 901 + 120 },
  { name: "the owner plan deadline", now: 901, planDeadline: 960, settlement: 960 },
])("settles a late verified run as a v3 completion bounded by $name", async (scenario) => {
  const { output } = await completion({ now: scenario.now, planDeadline: scenario.planDeadline });
  expect(output.fields.effectContract).toBe("work.assignment_completion.v3");
  expect(output.effect).toMatchObject({
    schemaVersion: 3,
    roleEvaluationArtifactHash: null,
    terminalEventId,
    executionCompletedAt: iso(30),
    preparedAt: iso(scenario.now),
    settlementDeadline: iso(scenario.settlement),
  });
});

it("treats preparation exactly at lease expiry as late", async () => {
  const { output } = await completion({ now: 900 });
  expect(output.fields.effectContract).toBe("work.assignment_completion.v3");
  expect(output.effect).toMatchObject({ preparedAt: iso(900), settlementDeadline: iso(1020) });
});

it("treats preparation after the responsibility deadline as late before lease expiry", async () => {
  const { output } = await completion({ now: 700, completionDeadline: 600 });
  expect(output.effect).toMatchObject({ schemaVersion: 3, settlementDeadline: iso(820) });
});

it.each([
  { name: "no terminal event", terminal: null },
  { name: "a failed run", terminal: { type: "run.failed", occurredAt: 30 } },
  { name: "a run before the lease", terminal: { type: "run.completed", occurredAt: -1 } },
  { name: "a run at lease expiry", terminal: { type: "run.completed", occurredAt: 900 } },
  {
    name: "a run at the responsibility deadline",
    terminal: { type: "run.completed", occurredAt: 800 },
    completionDeadline: 800,
  },
])("refuses late completion of $name", async (scenario) => {
  await expect(
    completion({
      now: 901,
      terminal: scenario.terminal,
      completionDeadline: scenario.completionDeadline ?? 1200,
    }),
  ).rejects.toThrow(/original execution authority/u);
});
