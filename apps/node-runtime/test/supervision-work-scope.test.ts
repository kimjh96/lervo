import { rm } from "node:fs/promises";
import type { OperatingMandateV3 } from "@lervo/application-contract";
import {
  claimAssignment,
  completeAssignment,
  createAssignment,
  listAssignments,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { collectProjectEventsBounded } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installationFixture } from "../../cli/test/mandate-installation.fixture.js";
import {
  createRepositoryMandatePlan,
  installRepositoryMandate,
} from "../../cli/src/mandate-installation.js";
import { observeSupervisionHostIdentity } from "../src/supervision-execution-host.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("installed reviewed work scope", () => {
  it("preserves legacy failure outside the goal, reopens scope, and rejects source drift", async () => {
    const f = await installationFixture(roots);
    const storage = await openProjectStorage(f.root);
    try {
      const anchor = collectProjectEventsBounded({
        events: storage.events,
        maximumEvents: 1000,
      }).findLast((event) => event.type === "workstream.snapshot.recorded")!;
      const now = new Date(Date.parse(anchor.occurredAt) - 1000);
      const prior = await createAssignment({
        repositoryRoot: f.root,
        taskType: "research",
        roleId: f.owner.roleId,
        expectedPaths: ["src"],
        acceptanceCriteria: ["Historical operator task, not this goal."],
        verificationSuiteIds: ["old.verification"],
        workstreamId: String(anchor.payload.workstreamId),
        now,
      });
      const leased = await claimAssignment({
        repositoryRoot: f.root,
        assignmentId: prior.assignmentId,
        agentId: f.owner.agentId,
        sessionId: `ses_${"c".repeat(24)}`,
        now,
      });
      const terminal = await completeAssignment({
        repositoryRoot: f.root,
        assignmentId: prior.assignmentId,
        agentId: f.owner.agentId,
        leaseId: leased.lease!.leaseId,
        resultArtifacts: [],
        verificationStatus: "failed",
        failureCode: "user_rejected_subagent_mode",
        now,
      });
      const mandate: OperatingMandateV3 = {
        ...f.mandate,
        schemaVersion: 3,
        executionAuthority: {
          schemaVersion: 1,
          mode: "designated_host",
          hostIdentityHash: (await observeSupervisionHostIdentity()).hostIdentityHash,
        },
        workScope: {
          schemaVersion: 1,
          workstreamId: String(anchor.payload.workstreamId),
          snapshotEventId: anchor.eventId,
          snapshotEventHash: anchor.eventHash,
          excludedAssignments: [
            { assignmentId: prior.assignmentId, contentHash: operatingContractHash(terminal) },
          ],
        },
      };
      const plan = await createRepositoryMandatePlan({
        root: f.root,
        supervisionId: "supervision.scoped",
        mandate,
        reviewerId: mandate.appointingAuthorityId,
      });
      const installed = await installRepositoryMandate({
        root: f.root,
        plan,
        approval: plan.approvalHash,
        reviewerId: mandate.appointingAuthorityId,
      });
      const binding = {
        supervisionId: "supervision.scoped",
        ownerAgentId: f.owner.agentId,
        workstreamId: mandate.workScope.workstreamId,
        mandateHash: installed.mandateHash,
      };
      const tasks = new SupervisionTaskSource(storage, binding, () => new Date().toISOString());
      const source = await tasks.read();
      expect(source.assignments).toEqual([]);
      expect(source.workstreamAssignments).toEqual([terminal]);
      expect((await tasks.readSnapshot()).unboundAssignmentIds).toEqual([]);
      expect(await listAssignments(f.root)).toEqual([terminal]);
      const reads = vi.spyOn(storage.events, "list");
      await tasks.read();
      expect(reads).not.toHaveBeenCalled();
      reads.mockRestore();
      const reopened = new SupervisionTaskSource(storage, binding, () => new Date().toISOString());
      expect((await reopened.read()).sourceRevisionDigest).toBe(source.sourceRevisionDigest);
      await createAssignment({
        repositoryRoot: f.root,
        taskType: "research",
        roleId: f.owner.roleId,
        expectedPaths: ["src"],
        acceptanceCriteria: ["Undeclared historical task."],
        verificationSuiteIds: ["old.verification"],
        workstreamId: binding.workstreamId,
        now,
      });
      await expect(tasks.read()).rejects.toThrow(/omits prior work/iu);
    } finally {
      await storage.close();
    }
  });
});
