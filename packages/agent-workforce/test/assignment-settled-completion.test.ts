import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  registerAgent,
  createAssignment,
  claimAssignment,
  listAssignments,
  reconcileAssignmentCompletion,
  reconcileSettledAssignmentCompletion,
} from "../src/index.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-settled-completion-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_settlement_001" }));
  return root;
}
it("settles verified work after its lease without accepting late or stale execution", async () => {
  const root = await repository();
  const agent = await registerAgent({ repositoryRoot: root, roleId: "developer" });
  const assignment = await createAssignment({
    repositoryRoot: root,
    taskType: "implementation",
    roleId: "developer",
    acceptanceCriteria: ["Recovered work is complete."],
    verificationSuiteIds: ["project.quick"],
    expectedPaths: ["src/recovered"],
  });
  const claimed = await claimAssignment({
    repositoryRoot: root,
    assignmentId: assignment.assignmentId,
    agentId: agent.agentId,
    sessionId: "ses_reconciliation_fixture",
    leaseDurationMs: 5_000,
    now: new Date("2026-09-01T00:00:00.000Z"),
  });
  const reconcile = {
    repositoryRoot: root,
    assignmentId: claimed.assignmentId,
    assignmentRevision: claimed.revision,
    agentId: agent.agentId,
    leaseId: claimed.lease!.leaseId,
    resultArtifact: {
      artifactId: `art_${"a".repeat(64)}`,
      contentHash: `sha256:${"a".repeat(64)}`,
    },
    completionEvidenceId: `acp_${"b".repeat(24)}`,
    reconciliationCommandId: `gcr_${"c".repeat(24)}`,
    sourceRunId: "run_reconciliation_fixture",
    preparedAt: "2026-09-01T00:00:40.000Z",
    executionCompletedAt: "2026-09-01T00:00:04.000Z",
    now: new Date("2026-09-01T00:01:00.000Z"),
  };
  await expect(
    reconcileSettledAssignmentCompletion({
      ...reconcile,
      executionCompletedAt: "2026-09-01T00:00:05.000Z",
    }),
  ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
  await expect(
    reconcileSettledAssignmentCompletion({
      ...reconcile,
      recordEvent: () => {
        throw new Error("event unavailable");
      },
    }),
  ).rejects.toMatchObject({ code: "workforce_write_failed" });
  expect(
    (await listAssignments(root)).find((item) => item.assignmentId === claimed.assignmentId),
  ).toMatchObject({ status: "leased", revision: claimed.revision });

  await expect(reconcileAssignmentCompletion(reconcile)).rejects.toMatchObject({
    code: "assignment_lease_conflict",
  });
  await expect(
    reconcileSettledAssignmentCompletion({
      ...reconcile,
      assignmentRevision: claimed.revision + 1,
    }),
  ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
  await expect(
    reconcileSettledAssignmentCompletion({ ...reconcile, executionCompletedAt: "invalid" }),
  ).rejects.toMatchObject({ code: "assignment_invalid" });
  const events: string[] = [];
  const completed = await reconcileSettledAssignmentCompletion({
    ...reconcile,
    recordEvent: (event) => {
      events.push(event.type);
    },
  });
  expect(completed).toMatchObject({ status: "completed", revision: claimed.revision + 1 });
  expect(events).toEqual(["assignment.completion.reconciled"]);
});
