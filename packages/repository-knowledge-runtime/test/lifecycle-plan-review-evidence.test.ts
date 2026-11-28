import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, expect, it } from "vitest";

import { prepareLifecyclePlanCrossCheck } from "../src/lifecycle-plan-review-input.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A continuation migration: its only change is Lervo's workstream state, derived from a document. */
const plan = {
  planKind: "continuation_workstream_migration",
  sourcePath: "docs/handoff/continuation.md",
  operations: [
    {
      path: ".lervo/state/workstreams/current.json",
      action: "create",
      ownership: "lervo_generated",
      content: '{"objective":"Hand over"}\n',
    },
  ],
};

it("shows the reviewer the unchanged document a plan derives from, beside its changed paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-review-evidence-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_review_evidence" }));
  await writeFile(join(root, "AGENTS.md"), "# Repository instructions\n\nKeep meaning.\n");
  await mkdir(join(root, "docs/handoff"), { recursive: true });
  const document = "# Hand over\n\n## Next actions\n\n1. Measure main.\n";
  await writeFile(join(root, "docs/handoff/continuation.md"), document);
  const paths = [".lervo/state/workstreams/current.json"];

  const withEvidence = await prepareLifecyclePlanCrossCheck({
    repositoryRoot: root,
    plan,
    paths,
    evidencePaths: ["docs/handoff/continuation.md"],
  });
  const data = withEvidence.request.untrustedSourceData as {
    sources: Array<{ path: string; content: string | null }>;
    evidence?: Array<{ path: string; contentHash: string | null; content: string | null }>;
    changedPaths: string[];
  };
  // The generated workstream stays bound by hash only; the source document is evidence.
  expect(data.sources).toMatchObject([{ path: paths[0], content: null }]);
  expect(data.changedPaths).toEqual(paths);
  expect(data.evidence).toEqual([
    {
      path: "docs/handoff/continuation.md",
      contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      content: document,
    },
  ]);

  const without = await prepareLifecyclePlanCrossCheck({ repositoryRoot: root, plan, paths });
  expect(without.request.untrustedSourceData).not.toHaveProperty("evidence");
  expect(without.systemPrompt).toContain("Evidence holds the exact bytes of unchanged files");
});
