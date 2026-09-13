import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  readCurrentWorkstreamState,
} from "@lervo/repository-knowledge";
import { installationFixture } from "../../cli/test/mandate-installation.fixture.js";
import { loadSupervisionPlanningContext } from "../src/supervision-planning-context.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("grounded planning source loading", () => {
  it("loads required instructions and product bytes without claiming provider injection or use", async () => {
    const f = await installationFixture(roots, async (root) => {
      await writeFile(
        resolve(root, "README.md"),
        "# Document persistence\n\nSave documents atomically and recover them after restart.\n",
      );
      await writeFile(
        resolve(root, "AGENTS.md"),
        "# Instructions\n\nVerify that saved documents survive restart.\n",
      );
    });
    await applyKnowledgeMigrationPlan(
      await createKnowledgeMigrationPlan({ repositoryRoot: f.root }),
      new Date(),
      () => undefined,
    );
    const state = (await readCurrentWorkstreamState(f.root))!;
    const input = {
      repositoryRoot: f.root,
      projectId: f.owner.projectId,
      workstreamId: state.snapshot.workstreamId,
      workstreamRevision: state.snapshot.revision,
      purpose: "document persistence after restart",
      expectedPaths: ["src/save.ts"],
      now: () => new Date().toISOString(),
    };
    const result = await loadSupervisionPlanningContext(input);
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "AGENTS.md",
          required: true,
          text: expect.stringContaining("survive restart"),
        }),
        expect.objectContaining({
          path: "README.md",
          required: true,
          text: expect.stringContaining("atomically"),
        }),
      ]),
    );
    expect(result.evidence).toMatchObject({ injection: "not_observed", use: "not_observed" });
    expect(result.evidence.attempts.length).toBeGreaterThan(0);
    await expect(
      loadSupervisionPlanningContext({ ...input, workstreamRevision: state.snapshot.revision + 1 }),
    ).rejects.toThrow("exact workstream revision and lifecycle");
  });
});
