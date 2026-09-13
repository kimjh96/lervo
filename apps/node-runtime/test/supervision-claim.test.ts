import { supervisionClaimDuration } from "../src/supervision-claim-duration.js";
import { rm } from "node:fs/promises";
import { changeAgentStatus, createAssignment, listAssignments } from "@lervo/agent-workforce";
import { operatingContractHash } from "@lervo/work-controller";
import { afterEach, describe, expect, it } from "vitest";
import { NodeSupervisionStore } from "../src/supervision-store.js";
import { supervisionFixture } from "./supervision.fixture.js";
import { responsibility } from "../../../packages/work-controller/test/operating-supervision.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const f = await supervisionFixture(roots);
  const task = responsibility();
  const assignment = await createAssignment({
    repositoryRoot: f.root,
    workstreamId: f.binding.workstreamId,
    taskType: "implementation",
    roleId: f.owner.roleId,
    expectedPaths: task.expectedPaths,
    acceptanceCriteria: task.acceptanceCriteria,
    verificationSuiteIds: task.verificationSuiteIds,
  });
  Object.assign(task, {
    assignmentId: assignment.assignmentId,
    assignmentRevision: assignment.revision + 1,
    executorAgentId: f.owner.agentId,
    reviewerAgentId: f.owner.agentId,
    roleContractHash: f.owner.roleContractHash,
    roleVersion: f.owner.roleVersion,
    requiredCapabilities: ["filesystem.write"],
    handoffRecipientIds: [f.owner.agentId],
    startDeadline: new Date(Date.now() + 60_000).toISOString(),
    progressDeadline: new Date(Date.now() + 120_000).toISOString(),
    completionDeadline: new Date(Date.now() + 180_000).toISOString(),
  });
  const input = {
    responsibility: task,
    expectedAssignmentHash: operatingContractHash(assignment),
    sessionId: "ses_node_claim",
    leaseDurationMs: 60_000,
    maximumDeadlineMs: f.mandate.maximumDeadlineMs,
    causationEventIds: f.observation.causationEventIds,
  };
  const store = await NodeSupervisionStore.open({ repositoryRoot: f.root, binding: f.binding });
  return { ...f, assignment, input, store };
}

describe("Node responsibility claim composition", () => {
  it("leaves admission time inside the actual task completion deadline", async () => {
    const f = await fixture();
    try {
      const before = Date.now() - 2000;
      f.input.responsibility.completionDeadline = new Date(before + 150000).toISOString();
      f.input.leaseDurationMs = supervisionClaimDuration(
        f.input.responsibility,
        new Date(before).toISOString(),
      );
      const claimed = await f.store.withOwner(async (session) => {
        const authority = await session.readAuthority();
        return session.claimResponsibility(
          f.input,
          authority.source.sourceRevisionDigest,
          async () => undefined,
        );
      });
      expect(Date.parse(claimed!.assignment.lease!.expiresAt)).toBeLessThanOrEqual(
        Date.parse(f.input.responsibility.completionDeadline),
      );
      expect(() =>
        supervisionClaimDuration(f.input.responsibility, new Date(before + 145001).toISOString()),
      ).toThrow(/insufficient time/iu);
    } finally {
      await f.store.close();
    }
  });
  it("persists the exact binding and reads the same claim in a new owner session", async () => {
    const f = await fixture();
    try {
      const first = await f.store.withOwner(async (session) => {
        const authority = await session.readAuthority();
        return session.claimResponsibility(
          f.input,
          authority.source.sourceRevisionDigest,
          async () => undefined,
        );
      });
      const second = await f.store.withOwner(async (session) =>
        session.readResponsibility(f.assignment.assignmentId),
      );
      expect(second).toEqual(first!.responsibility);
      expect(second!.responsibility.assignmentRevision).toBe(f.assignment.revision + 1);
    } finally {
      await f.store.close();
    }
  });

  it.each([1, 2])(
    "rolls back when owner authority disappears during claim observation %s",
    async (at) => {
      const f = await fixture();
      try {
        await expect(
          f.store.withOwner(async (session) => {
            const authority = await session.readAuthority();
            let count = 0;
            return session.claimResponsibility(
              f.input,
              authority.source.sourceRevisionDigest,
              async () => {
                if (++count === at)
                  await changeAgentStatus({
                    repositoryRoot: f.root,
                    agentId: f.owner.agentId,
                    expectedRevision: f.owner.revision,
                    status: "suspended",
                  });
              },
            );
          }),
        ).rejects.toThrow();
        expect((await listAssignments(f.root))[0]).toEqual(f.assignment);
      } finally {
        await f.store.close();
      }
    },
  );
});
