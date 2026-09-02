import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  claimAssignment,
  createAssignment,
  listAssignments,
  registerAgent,
} from "@lervo/agent-workforce";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { finalizeGovernedAssignment } from "../src/governed-assignment-finalization.js";
import { activateFixtureEventWriterV2 } from "../../../packages/project/test/fixture-event-writer.js";

const roots: string[] = [];
const workstreamId = "wks_111111111111111111111111";

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-completion-evidence-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_completion_evidence_01",
      now: new Date("2026-09-01T00:00:00.000Z"),
    }),
  );
  await activateFixtureEventWriterV2({
    repositoryRoot: root,
    projectId: "prj_completion_evidence_01",
    observedAt: "2026-09-01T00:00:01.000Z",
  });
  return root;
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("governed completion evidence", () => {
  it("records exact prepared evidence before ordinary assignment completion", async () => {
    const root = await repository();
    const agent = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const assignment = await createAssignment({
      repositoryRoot: root,
      taskType: "implementation",
      roleId: "developer",
      acceptanceCriteria: ["The managed result is accepted."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["src/result.ts"],
      workstreamId,
    });
    const claimed = await claimAssignment({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      agentId: agent.agentId,
      sessionId: "ses_assignment_lease_fixture",
      now: new Date("2026-09-01T00:00:00.000Z"),
    });
    const runId = "run_completion_evidence_fixture";
    const sessionId = "ses_completion_evidence_fixture";
    const resultContentHash = `sha256:${"a".repeat(64)}`;
    const resultArtifactId = `art_${"a".repeat(64)}`;
    const storage = await openProjectStorage(root);
    try {
      storage.events.append({
        eventId: "evt_completion_causality_fixture",
        projectId: storage.manifest.projectId,
        runId,
        sessionId,
        type: "work.causality.recorded",
        occurredAt: "2026-09-01T00:00:10.000Z",
        actor: { kind: "system" },
        schemaVersion: 2,
        policyVersion: `sha256:${"1".repeat(64)}`,
        payload: {
          workId: `wrk_${"1".repeat(24)}`,
          executionContractVersion: 1,
          relationship: "root",
          parentRunId: null,
          retryOfRunId: null,
          attemptOrdinal: 1,
          workstreamId,
          assignmentId: assignment.assignmentId,
          agentId: agent.agentId,
        },
      });
      storage.events.append({
        eventId: "evt_completion_terminal_fixture",
        projectId: storage.manifest.projectId,
        runId,
        sessionId,
        type: "run.completed",
        occurredAt: "2026-09-01T00:00:20.000Z",
        actor: { kind: "system" },
        schemaVersion: 2,
        policyVersion: `sha256:${"2".repeat(64)}`,
        payload: {
          resultDigest: resultContentHash,
          artifactIds: [resultArtifactId, "art_verification_result_fixture"],
          verificationStatus: "passed",
        },
      });
    } finally {
      await storage.close();
    }

    await finalizeGovernedAssignment({
      repositoryRoot: root,
      assignmentId: assignment.assignmentId,
      agentId: agent.agentId,
      leaseId: claimed.lease!.leaseId,
      verificationStatus: "passed",
      resultArtifacts: [{ artifactId: resultArtifactId, contentHash: resultContentHash }],
      completionEvidence: {
        workstreamId,
        assignmentRevision: claimed.revision,
        runId,
        sessionId,
        writingPublicationStatus: "allowed",
      },
      now: new Date("2026-09-01T00:01:00.000Z"),
    });

    expect(
      (await listAssignments(root)).find(
        (candidate) => candidate.assignmentId === assignment.assignmentId,
      ),
    ).toMatchObject({ status: "completed", revision: claimed.revision + 1 });
    const recorded = await openProjectStorage(root);
    try {
      const events = recorded.events.list({ limit: 100 });
      expect(events.slice(-2).map((event) => event.type)).toEqual([
        "assignment.completion.prepared",
        "assignment.completed",
      ]);
      expect(events.at(-2)).toMatchObject({ runId, sessionId });
    } finally {
      await recorded.close();
    }
  });
});
