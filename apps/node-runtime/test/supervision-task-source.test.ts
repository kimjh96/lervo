import { rm } from "node:fs/promises";
import { createAssignment } from "@lervo/agent-workforce";
import * as workforce from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { supervisionFixture } from "./supervision.fixture.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("canonical supervision task source", () => {
  it("reads real graph and unbound work without inventing attempts, and skips warm historical reads", async () => {
    const f = await supervisionFixture(roots);
    const storage = await openProjectStorage(f.root);
    try {
      const source = new SupervisionTaskSource(storage, f.binding, () => new Date().toISOString());
      const first = await source.read();
      const reads = vi.spyOn(storage.events, "list");
      const second = await source.read();
      expect(second.sourceRevisionDigest).toBe(first.sourceRevisionDigest);
      expect(reads).not.toHaveBeenCalled();
      const assignment = await createAssignment({
        repositoryRoot: f.root,
        workstreamId: f.binding.workstreamId,
        roleId: f.owner.roleId,
        taskType: "implementation",
        expectedPaths: ["src"],
        acceptanceCriteria: ["Save survives restart."],
        verificationSuiteIds: ["save.restart"],
      });
      const changed = await source.read();
      expect(changed.sourceRevisionDigest).not.toBe(first.sourceRevisionDigest);
      expect(changed.graph.nodes.map((node) => node.assignmentId)).toContain(
        assignment.assignmentId,
      );
      expect(changed.responsibilities).toEqual([
        { assignmentId: assignment.assignmentId, binding: null },
      ]);
      expect(changed.execution.attempts).toEqual([]);
      expect(changed.execution.resources).toEqual([]);
    } finally {
      await storage.close();
    }
  });

  it("rejects a relevant assignment change that arrives during a composed observation", async () => {
    const f = await supervisionFixture(roots);
    const storage = await openProjectStorage(f.root);
    try {
      const source = new SupervisionTaskSource(storage, f.binding, () => new Date().toISOString());
      const read = source.read.bind(source);
      let injected = false;
      vi.spyOn(source, "read").mockImplementation(async (excludedDecisionId) => {
        const snapshot = await read(excludedDecisionId);
        if (!injected) {
          injected = true;
          await createAssignment({
            repositoryRoot: f.root,
            workstreamId: f.binding.workstreamId,
            roleId: f.owner.roleId,
            taskType: "implementation",
            expectedPaths: ["src"],
            acceptanceCriteria: ["Concurrent assignment is observed."],
            verificationSuiteIds: ["assignment.concurrent"],
          });
        }
        return snapshot;
      });

      await expect(source.readSnapshot()).rejects.toThrow(
        /supervision observation changed while reading result evidence/u,
      );
    } finally {
      await storage.close();
    }
  });

  it("keeps a bound task observation stable while unrelated background work is assigned", async () => {
    const f = await supervisionFixture(roots);
    const storage = await openProjectStorage(f.root);
    try {
      const originalList = workforce.listAssignments;
      let injected = false;
      vi.spyOn(workforce, "listAssignments").mockImplementation(async (root) => {
        const assignments = await originalList(root);
        if (!injected) {
          injected = true;
          await createAssignment({
            repositoryRoot: f.root,
            roleId: f.owner.roleId,
            taskType: "knowledge.background.review",
            expectedPaths: ["docs"],
            acceptanceCriteria: ["Review unrelated repository knowledge."],
            verificationSuiteIds: ["knowledge.review"],
          });
        }
        return assignments;
      });

      const source = new SupervisionTaskSource(storage, f.binding, () => new Date().toISOString());
      const observed = await source.read();
      expect(injected).toBe(true);
      expect(observed.workstreamAssignments).toEqual([]);
      expect(observed.graph.nodes).toEqual([]);
      expect(await originalList(f.root)).toHaveLength(1);
    } finally {
      await storage.close();
    }
  });
});
