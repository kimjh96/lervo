import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { afterEach, expect, it } from "vitest";
import { createAssignment, listAssignments } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["valid", "foreign_project", "wrong_id", "stale_role"])(
  "validates every record in an assignment listing (%s)",
  async (kind) => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-assignment-list-"));
    roots.push(root);
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_assignment_list_01" }));
    const assignments = [];
    for (let i = 0; i < 3; i++)
      assignments.push(
        await createAssignment({
          repositoryRoot: root,
          taskType: "implementation",
          roleId: "developer",
          acceptanceCriteria: ["Pass the declared verification."],
          verificationSuiteIds: ["project.quick"],
          expectedPaths: [`src/task-${i}.ts`],
        }),
      );
    assignments.sort((a, b) => a.assignmentId.localeCompare(b.assignmentId));
    expect(await listAssignments(root)).toEqual(assignments);
    if (kind === "valid") return;
    const last = assignments.at(-1)!;
    const changed = {
      ...last,
      ...(kind === "foreign_project" ? { projectId: "prj_another_project_01" } : {}),
      ...(kind === "wrong_id" ? { assignmentId: assignments[0]!.assignmentId } : {}),
      ...(kind === "stale_role" ? { roleContractHash: `sha256:${"0".repeat(64)}` } : {}),
    };
    const home = await resolveRepositoryCoordinationHome(root);
    await writeFile(
      resolve(home.workforce, "assignments", `${last.assignmentId}.json`),
      JSON.stringify(changed),
      { mode: 0o600 },
    );
    await expect(listAssignments(root)).rejects.toMatchObject({
      code: kind === "stale_role" ? "assignment_lease_conflict" : "workforce_state_invalid",
    });
  },
);
