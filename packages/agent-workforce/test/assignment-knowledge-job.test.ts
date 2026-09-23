import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { resolveRoleContract } from "@lervo/roles";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertAssignmentExecutionAuthority,
  assertReadOnlyKnowledgeReviewAuthority,
  claimAssignment,
  createAssignment,
  createKnowledgeJobAssignment,
  registerAgent,
  type WorkforceEvent,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workforce-knowledge-job-"));
  roots.push(root);
  await mkdir(resolve(root, "docs"));
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_knowledge_job_test_01",
      now: new Date("2026-09-23T04:00:00.000Z"),
    }),
  );
  return root;
}

describe("knowledge-job assignment provenance", () => {
  it("materializes once, binds the completion and exact agent, and rejects changed replay", async () => {
    const root = await repository();
    const contract = await resolveRoleContract(root, "developer");
    const owner = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      responsibilityPaths: ["docs"],
    });
    const other = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      responsibilityPaths: ["docs"],
    });
    const events: WorkforceEvent[] = [];
    const input = {
      repositoryRoot: root,
      taskType: "repository.knowledge",
      roleId: "developer",
      roleVersion: contract.version,
      roleContractHash: contract.contractHash,
      requiredCapabilityHash: owner.capabilityHash,
      priority: 30,
      dependencyIds: [],
      acceptanceCriteria: ["Review the exact source and converge canonical knowledge."],
      verificationSuiteIds: ["knowledge.lifecycle"],
      approvalRequirements: [],
      expectedPaths: ["docs/knowledge.md"],
      workstreamId: "wks_abcdefabcdefabcdefabcdef",
      knowledgeJob: {
        contractVersion: 1 as const,
        jobId: `kjb_${"a".repeat(24)}`,
        completionEventId: "evt_knowledge_completion_001",
        completionEventHash: `sha256:${"b".repeat(64)}`,
        sourceConversationEventId: `cve_${"c".repeat(64)}`,
        sourceManifestHash: `sha256:${"d".repeat(64)}`,
        agentId: owner.agentId,
      },
      recordEvent: (event: WorkforceEvent) => {
        events.push(event);
      },
    };
    const assignment = await createKnowledgeJobAssignment(input);
    expect(assignment.accessMode).toBe("read_only");
    const replay = await createKnowledgeJobAssignment(input);
    expect(replay.assignmentId).toBe(assignment.assignmentId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "assignment.created",
      payload: {
        assignmentId: assignment.assignmentId,
        knowledgeJobId: input.knowledgeJob.jobId,
        knowledgeCompletionEventId: input.knowledgeJob.completionEventId,
        knowledgeAgentId: owner.agentId,
        accessMode: "read_only",
      },
    });
    await expect(
      createKnowledgeJobAssignment({
        ...input,
        knowledgeJob: { ...input.knowledgeJob, sourceManifestHash: `sha256:${"e".repeat(64)}` },
      }),
    ).rejects.toMatchObject({ code: "assignment_invalid" });
    await expect(
      claimAssignment({
        repositoryRoot: root,
        assignmentId: assignment.assignmentId,
        agentId: other.agentId,
        sessionId: "ses_knowledge_other_01",
      }),
    ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
    await expect(
      claimAssignment({
        repositoryRoot: root,
        assignmentId: assignment.assignmentId,
        agentId: owner.agentId,
        sessionId: "ses_knowledge_owner_01",
      }),
    ).resolves.toMatchObject({ status: "leased", assigneeAgentId: owner.agentId });
  });

  it.each(["reader_first", "writer_first"])(
    "lets a read-only knowledge review overlap a live writer without granting write authority (%s)",
    async (order) => {
      const root = await repository();
      const reviewer = await registerAgent({
        repositoryRoot: root,
        roleId: "developer",
        provider: "codex",
        responsibilityPaths: ["docs"],
      });
      const writer = await registerAgent({
        repositoryRoot: root,
        roleId: "developer",
        provider: "codex",
        responsibilityPaths: ["docs"],
      });
      const contract = await resolveRoleContract(root, "developer");
      const review = await createKnowledgeJobAssignment({
        repositoryRoot: root,
        taskType: "repository.knowledge.review",
        roleId: "developer",
        roleVersion: contract.version,
        roleContractHash: contract.contractHash,
        requiredCapabilityHash: reviewer.capabilityHash,
        priority: 30,
        dependencyIds: [],
        acceptanceCriteria: ["Review the exact source without modifying the repository."],
        verificationSuiteIds: ["knowledge.lifecycle"],
        approvalRequirements: [],
        expectedPaths: ["docs/knowledge.md"],
        workstreamId: "wks_abcdefabcdefabcdefabcdef",
        knowledgeJob: {
          contractVersion: 1,
          jobId: `kjb_${"a".repeat(24)}`,
          completionEventId: "evt_knowledge_completion_001",
          completionEventHash: `sha256:${"b".repeat(64)}`,
          sourceConversationEventId: `cve_${"c".repeat(64)}`,
          sourceManifestHash: `sha256:${"d".repeat(64)}`,
          agentId: reviewer.agentId,
        },
      });
      const live = await createAssignment({
        repositoryRoot: root,
        roleId: "developer",
        taskType: "implementation",
        acceptanceCriteria: ["Update the authorized source."],
        verificationSuiteIds: ["project.quick"],
        expectedPaths: ["docs/knowledge.md"],
      });
      const claimReview = () =>
        claimAssignment({
          repositoryRoot: root,
          assignmentId: review.assignmentId,
          agentId: reviewer.agentId,
          sessionId: "ses_knowledge_review_01",
        });
      const claimLive = () =>
        claimAssignment({
          repositoryRoot: root,
          assignmentId: live.assignmentId,
          agentId: writer.agentId,
          sessionId: "ses_knowledge_writer_01",
        });
      const claimed =
        order === "reader_first"
          ? await (async () => {
              const read = await claimReview();
              await claimLive();
              return read;
            })()
          : await (async () => {
              await claimLive();
              return claimReview();
            })();
      await expect(
        assertAssignmentExecutionAuthority({
          repositoryRoot: root,
          assignmentId: review.assignmentId,
          agentId: reviewer.agentId,
          leaseId: claimed.lease!.leaseId,
          provider: "codex",
          expectedPaths: ["docs/knowledge.md"],
          verificationSuiteIds: ["knowledge.lifecycle"],
        }),
      ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
      await expect(
        assertReadOnlyKnowledgeReviewAuthority({
          repositoryRoot: root,
          assignmentId: review.assignmentId,
          agentId: reviewer.agentId,
          leaseId: claimed.lease!.leaseId,
          provider: "codex",
          sourcePaths: ["docs/knowledge.md"],
          verificationSuiteIds: ["knowledge.lifecycle"],
          knowledgeJob: review.knowledgeJob!,
        }),
      ).resolves.toMatchObject({ assignment: { accessMode: "read_only" } });
      await expect(
        assertReadOnlyKnowledgeReviewAuthority({
          repositoryRoot: root,
          assignmentId: review.assignmentId,
          agentId: reviewer.agentId,
          leaseId: claimed.lease!.leaseId,
          provider: "codex",
          sourcePaths: ["docs/other.md"],
          verificationSuiteIds: ["knowledge.lifecycle"],
          knowledgeJob: review.knowledgeJob!,
        }),
      ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
      await expect(
        assertReadOnlyKnowledgeReviewAuthority({
          repositoryRoot: root,
          assignmentId: review.assignmentId,
          agentId: reviewer.agentId,
          leaseId: claimed.lease!.leaseId,
          provider: "codex",
          sourcePaths: ["docs/knowledge.md"],
          verificationSuiteIds: ["knowledge.lifecycle"],
          knowledgeJob: {
            ...review.knowledgeJob!,
            sourceManifestHash: `sha256:${"e".repeat(64)}`,
          },
        }),
      ).rejects.toMatchObject({ code: "assignment_lease_conflict" });
    },
  );

  it("rejects missing workstream and malformed provenance before writing state", async () => {
    const root = await repository();
    const contract = await resolveRoleContract(root, "developer");
    const input = {
      repositoryRoot: root,
      taskType: "repository.knowledge",
      roleId: "developer",
      roleVersion: contract.version,
      roleContractHash: contract.contractHash,
      requiredCapabilityHash: null,
      priority: 30,
      dependencyIds: [],
      acceptanceCriteria: ["Review canonical knowledge."],
      verificationSuiteIds: ["knowledge.lifecycle"],
      approvalRequirements: [],
      expectedPaths: ["docs/knowledge.md"],
      workstreamId: "wks_abcdefabcdefabcdefabcdef",
      knowledgeJob: {
        contractVersion: 1 as const,
        jobId: `kjb_${"a".repeat(24)}`,
        completionEventId: "evt_knowledge_completion_001",
        completionEventHash: `sha256:${"b".repeat(64)}`,
        sourceConversationEventId: `cve_${"c".repeat(64)}`,
        sourceManifestHash: null,
        agentId: `agt_${"d".repeat(24)}`,
      },
    };
    await expect(
      createKnowledgeJobAssignment({ ...input, workstreamId: "invalid" }),
    ).rejects.toMatchObject({ code: "assignment_invalid" });
    await expect(
      createKnowledgeJobAssignment({
        ...input,
        knowledgeJob: { ...input.knowledgeJob, sourceConversationEventId: "private message" },
      }),
    ).rejects.toMatchObject({ code: "assignment_invalid" });
  });
});
