import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { assessCanonicalization } from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import {
  canonicalizationAssignment,
  normalizationAssignment,
  pendingCanonicalizationCandidates,
} from "../src/conversation-canonicalization-assignment.js";
import { executionInstructions } from "../src/conversation-repository-work-writing.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("assigns open background candidates to the next write-capable Discord turn", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-canon-assign-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, "src/a.ts"), "export const a = 2;\n");
  const { createHash } = await import("node:crypto");
  const after = `sha256:${createHash("sha256").update("export const a = 2;\n").digest("hex")}`;
  await assessCanonicalization({
    repositoryRoot: root,
    beforeRevision: `sha256:${"1".repeat(64)}`,
    afterRevision: `sha256:${"2".repeat(64)}`,
    beforeFiles: {},
    afterFiles: { "src/a.ts": after },
    disposition: "canonical_sources_current",
    now: new Date("2026-09-25T12:00:00.000Z"),
  });
  const [candidate] = await pendingCanonicalizationCandidates(root);
  expect(candidate).toMatchObject({ state: "candidate", sourcePaths: ["src/a.ts"] });
  const instructions = executionInstructions({
    request: "Fix the typo.",
    priorTurns: [],
    durableResults: [],
    worker: { displayName: "Vero", roleId: "developer" },
    externalEffectsAuthorized: false,
    finalizationStartsAt: "2026-09-25T12:10:00.000Z",
    canonicalizationCandidates: [candidate!],
  });
  expect(instructions).toContain(
    `lervo knowledge canonicalization promote ${candidate!.candidateId} --reviewer developer --approval ${candidate!.contentHash}`,
  );
  // A drifted source only permits rejection.
  await writeFile(resolve(root, "src/a.ts"), "export const a = 3;\n");
  const [stale] = await pendingCanonicalizationCandidates(root);
  expect(canonicalizationAssignment([stale!], "developer")).toContain("--decision reject");
  expect(canonicalizationAssignment([], "developer")).toBeNull();
  expect(await pendingCanonicalizationCandidates(resolve(root, "missing"))).toEqual([]);
  expect(normalizationAssignment(0)).toBeNull();
  expect(normalizationAssignment(3)).toContain("3 documents await normalization");
  expect(
    executionInstructions({
      request: "Fix the typo.",
      priorTurns: [],
      durableResults: [],
      worker: null,
      externalEffectsAuthorized: false,
      finalizationStartsAt: "2026-09-25T12:10:00.000Z",
      pendingNormalizationDocuments: 3,
    }),
  ).toContain("Document normalization debt: 3 documents await normalization");
});
