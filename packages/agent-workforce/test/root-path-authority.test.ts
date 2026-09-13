import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  assertAssignmentExecutionAuthority,
  claimAssignment,
  createAssignment,
  registerAgent,
  partitionWorkspaceChanges,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("registered repository-root authority", () => {
  it.each([".", "*"])(
    "claims descendants and blocks concurrent root overlap for %s",
    async (scope) => {
      const root = await mkdtemp(join(tmpdir(), "lervo-root-authority-"));
      roots.push(root);
      await applyInitPlan(await createInitPlan({ root }));
      const agent = await registerAgent({
        repositoryRoot: root,
        roleId: "developer",
        provider: "codex",
        responsibilityPaths: [scope],
      });
      const other = await registerAgent({
        repositoryRoot: root,
        roleId: "developer",
        provider: "codex",
        responsibilityPaths: ["docs"],
      });
      const assignment = async (path: string) =>
        createAssignment({
          repositoryRoot: root,
          roleId: "developer",
          taskType: "implementation",
          acceptanceCriteria: ["Preserve source bytes."],
          verificationSuiteIds: ["project.quick"],
          expectedPaths: [path],
        });
      const descendant = await assignment("docs/product/vision.md");
      await claimAssignment({
        repositoryRoot: root,
        assignmentId: descendant.assignmentId,
        agentId: other.agentId,
        sessionId: "ses_root_scope_other",
      });
      const whole = await assignment(scope);
      await expect(
        claimAssignment({
          repositoryRoot: root,
          assignmentId: whole.assignmentId,
          agentId: agent.agentId,
          sessionId: "ses_root_scope_worker",
        }),
      ).rejects.toMatchObject({ code: "assignment_path_conflict" });
      const disjoint = await assignment("src/save.ts");
      const claimed = await claimAssignment({
        repositoryRoot: root,
        assignmentId: disjoint.assignmentId,
        agentId: agent.agentId,
        sessionId: "ses_root_scope_worker",
      });
      await expect(
        assertAssignmentExecutionAuthority({
          repositoryRoot: root,
          assignmentId: claimed.assignmentId,
          agentId: agent.agentId,
          leaseId: claimed.lease!.leaseId,
          provider: "codex",
          expectedPaths: ["src/save.ts"],
          verificationSuiteIds: ["project.quick"],
        }),
      ).resolves.toMatchObject({ agent: { responsibilityPaths: [scope] } });
      expect(
        partitionWorkspaceChanges({
          expectedPaths: [scope],
          changedPaths: ["src/save.ts", "../secret"],
          runtimeExcludedPaths: [".lervo/state"],
        }),
      ).toEqual({ expected: ["src/save.ts"], outsideScope: ["../secret"], runtimeExcluded: [] });
    },
  );
});
