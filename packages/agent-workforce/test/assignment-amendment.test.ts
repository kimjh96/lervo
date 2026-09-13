import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { operatingContractHash } from "@lervo/work-controller";
import { sanitizeEventPayload } from "@lervo/event-contract";
import type { SupervisedAssignmentAmendmentV1 } from "@lervo/application-contract";
import { responsibility } from "../../work-controller/test/operating-supervision.fixture.js";
import {
  amendAssignment,
  amendedAssignment,
  claimAssignment,
  createAssignment,
  listAssignments,
  registerAgent,
  type WorkforceEvent,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-amendment-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_amendment_01" }));
  const agent = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    provider: "codex",
    responsibilityPaths: ["src"],
  });
  const previous = await createAssignment({
    repositoryRoot: root,
    taskType: "implementation",
    roleId: "developer",
    expectedPaths: ["src"],
    acceptanceCriteria: ["Initial acceptance"],
    verificationSuiteIds: ["repository.default"],
  });
  const predecessorBindingHash = operatingContractHash("exact previous binding");
  const effect: SupervisedAssignmentAmendmentV1 = {
    schemaVersion: 1,
    kind: "work.assignment_amendment",
    expectedAssignmentHash: operatingContractHash(previous),
    predecessorBindingHash,
    provider: "codex",
    rationaleArtifactHash: operatingContractHash("User changed the outcome"),
    responsibility: {
      ...responsibility(),
      assignmentId: previous.assignmentId,
      assignmentRevision: previous.revision + 2,
      executorAgentId: agent.agentId,
      reviewerAgentId: agent.agentId,
      roleId: previous.roleId,
      roleVersion: previous.roleVersion,
      roleContractHash: previous.roleContractHash,
      expectedPaths: ["src/component"],
      acceptanceCriteria: ["Revised acceptance"],
      verificationSuiteIds: ["repository.revised"],
      predecessorBindingHash,
    },
  };
  return { root, agent, previous, effect, now: new Date() };
}
it("records revised acceptance and verification with an exact predecessor before acquiring a lease", async () => {
  const f = await fixture();
  const events: WorkforceEvent[] = [];
  const next = await amendAssignment({
    repositoryRoot: f.root,
    effect: f.effect,
    now: f.now,
    recordEvent: (event) => {
      events.push(event);
    },
  });
  expect(next).toMatchObject({
    status: "queued",
    lease: null,
    expectedPaths: ["src/component"],
    acceptanceCriteria: ["Revised acceptance"],
    verificationSuiteIds: ["repository.revised"],
    amendment: {
      predecessorAssignmentHash: operatingContractHash(f.previous),
      successorResponsibilityHash: operatingContractHash(f.effect.responsibility),
    },
  });
  expect(events).toHaveLength(1);
  expect(sanitizeEventPayload("assignment.amended", events[0]!.payload).payload).toEqual(
    events[0]!.payload,
  );
  const claim = await claimAssignment({
    repositoryRoot: f.root,
    assignmentId: next.assignmentId,
    expectedRevision: next.revision,
    responsibilityBinding: f.effect.responsibility,
    agentId: f.agent.agentId,
    sessionId: "ses_amended_claim",
    now: f.now,
    recordEvent: () => undefined,
  });
  expect(claim.lease?.generation).toBe(1);
  expect(claim.revision).toBe(f.effect.responsibility.assignmentRevision);
  await expect(
    amendAssignment({
      repositoryRoot: f.root,
      effect: f.effect,
      now: f.now,
      recordEvent: () => undefined,
    }),
  ).rejects.toThrow(/exact unstarted/iu);
});
it("restores exact bytes when the amendment event fails", async () => {
  const f = await fixture();
  await expect(
    amendAssignment({
      repositoryRoot: f.root,
      effect: f.effect,
      now: f.now,
      recordEvent: () => {
        throw new Error("lost fence");
      },
    }),
  ).rejects.toThrow(/restored/iu);
  expect((await listAssignments(f.root))[0]).toEqual(f.previous);
});
it("rejects live leases, wider paths, role changes, and previously delivered work", async () => {
  const f = await fixture();
  for (const change of [
    { expectedPaths: ["outside"] },
    { roleVersion: "2.0.0" },
    { assignmentRevision: 10 },
  ])
    expect(() =>
      amendedAssignment(
        f.previous,
        { ...f.effect, responsibility: { ...f.effect.responsibility, ...change } },
        f.now.toISOString(),
      ),
    ).toThrow();
  const completed = { ...f.previous, status: "completed" as const };
  expect(() =>
    amendedAssignment(
      completed,
      { ...f.effect, expectedAssignmentHash: operatingContractHash(completed) },
      f.now.toISOString(),
    ),
  ).toThrow();
  const claim = await claimAssignment({
    repositoryRoot: f.root,
    assignmentId: f.previous.assignmentId,
    agentId: f.agent.agentId,
    sessionId: "ses_live_claim",
    now: f.now,
  });
  await expect(
    amendAssignment({
      repositoryRoot: f.root,
      effect: {
        ...f.effect,
        expectedAssignmentHash: operatingContractHash(claim),
        responsibility: { ...f.effect.responsibility, assignmentRevision: claim.revision + 2 },
      },
      now: f.now,
      recordEvent: () => undefined,
    }),
  ).rejects.toThrow(/exact unstarted/iu);
});
