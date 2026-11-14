import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";

import { retirePracticeSkill } from "../src/practice-retirement.js";
import type { PracticeState } from "../src/practice-state.js";
import { fixture } from "./fixture.js";

const plan = vi.hoisted(() => ({ edit: null as (() => void) | null, applied: 0 }));

vi.mock("../src/delegation.js", async (load) => ({
  ...(await load<typeof import("../src/delegation.js")>()),
  loadConvergenceDelegation: async () => null,
  assertConvergenceDelegation: async () => ({
    normalizationRoots: [".agents/skills"],
    canonicalRoots: [],
  }),
}));
vi.mock("../src/convergence-owner-fence.js", () => ({
  knowledgeOutputCommitGrant: async () => ({ allowed: true, hostHash: null }),
}));
vi.mock("../src/practice-assignment.js", () => ({
  withPracticeAssignment: async (input: { run(authority: unknown): Promise<unknown> }) =>
    input.run({}),
}));
// The seal and the ref integration are fenced and tested on their own.
vi.mock("../src/canonical-workspace.js", () => ({
  sealCanonicalDrafts: async () => ({ workspaceId: "wks_fixture", path: "", resultHash: "" }),
}));
vi.mock("../src/canonical-integration-candidate.js", () => ({
  prepareCanonicalGitIntegration: async () => ({ integration: { targetAfterCommit: "0" } }),
}));
vi.mock("@lervo/repository-knowledge", async (load) => {
  const actual = await load<typeof import("@lervo/repository-knowledge")>();
  return {
    ...actual,
    // Another writer edits while the layout permit is read, after every earlier fence.
    authorizeCurrentRepositoryDocumentLayout: async (
      ...args: Parameters<typeof actual.authorizeCurrentRepositoryDocumentLayout>
    ) => {
      plan.edit?.();
      return actual.authorizeCurrentRepositoryDocumentLayout(...args);
    },
    applyDurableKnowledgeOperations: async (
      ...args: Parameters<typeof actual.applyDurableKnowledgeOperations>
    ) => {
      plan.applied += 1;
      return actual.applyDurableKnowledgeOperations(...args);
    },
  };
});

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  plan.edit = null;
  plan.applied = 0;
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("refuses the root retirement when another writer edits after the earlier fences", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const path = ".agents/skills/unused/SKILL.md";
  const content = "---\nname: unused\n---\n# Unused\n";
  mkdirSync(resolve(f.root, ".agents/skills/unused"), { recursive: true });
  writeFileSync(resolve(f.root, path), content);
  execFileSync("git", ["-C", f.root, "add", "."]);
  execFileSync("git", [
    "-C",
    f.root,
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@lervo.invalid",
    "commit",
    "-qm",
    "skill",
  ]);
  plan.edit = () => appendFileSync(resolve(f.root, "README.md"), "Edited.\n");
  const state = { candidates: [], generated: [] } as unknown as PracticeState;
  await expect(
    retirePracticeSkill(
      {
        storage: f.storage,
        provider: "claude",
        signal: new AbortController().signal,
        liveWorkPending: async () => false,
        now: () => new Date(),
      } as unknown as Parameters<typeof retirePracticeSkill>[0],
      state,
      {
        name: "unused",
        path,
        versionHash: sha256(content),
        candidateId: "kprc_fixture",
        commit: "0",
        exposedAt: null,
        reevaluatedAt: null,
      },
      { reevaluate: true, usageState: "unused_with_coverage", coverage: "complete" } as never,
    ),
  ).rejects.toMatchObject({ code: "source_bytes_changed" });
  expect(plan.applied).toBe(0);
  expect(existsSync(resolve(f.root, path))).toBe(true);
});
