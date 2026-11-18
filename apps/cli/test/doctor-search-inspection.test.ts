import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import { inspectDoctorSearch } from "../src/doctor-search-inspection.js";
import { runCli } from "../src/main.js";
import { productDefaultSearchEngine } from "../src/product-default-search.js";
import { searchCandidateRegistry } from "../src/search-candidate-registry.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-doctor-search-"));
  roots.push(root);
  const silent = { cwd: root, stdout: () => undefined, stderr: () => undefined };
  expect(await runCli(["init"], silent)).toBe(0);
  return root;
}

describe("doctor search inspection", () => {
  it("reports the product-default engine as a healthy selection", async () => {
    const root = await repository();
    const project = await loadProjectManifest(root);
    const inspections = await inspectDoctorSearch({
      repositoryRoot: root,
      projectId: project.projectId,
      registry: searchCandidateRegistry,
      productDefault: productDefaultSearchEngine,
      observedAt: new Date("2026-08-20T10:00:00.000Z"),
    });

    expect(inspections.map((item) => item.check)).toEqual([
      { checkId: "search_engine_selection", status: "healthy", observedCount: 0 },
    ]);
  });

  it("reports an unresolvable product default as an unhealthy selection", async () => {
    const root = await repository();
    const project = await loadProjectManifest(root);
    const inspections = await inspectDoctorSearch({
      repositoryRoot: root,
      projectId: project.projectId,
      registry: searchCandidateRegistry,
      productDefault: {
        ...productDefaultSearchEngine,
        adapterBuildId: `sebuild_${"0".repeat(24)}`,
      },
      observedAt: new Date("2026-08-20T10:00:00.000Z"),
    });

    expect(inspections).toMatchObject([
      {
        check: { checkId: "search_engine_selection", status: "unhealthy" },
        issues: [{ code: "search_engine_selection_invalid" }],
      },
    ]);
  });
});
