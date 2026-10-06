import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  processKnowledgeConvergence,
  sha256,
  type KnowledgeConvergenceBaseline,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";
import { generateNormalizationBatch } from "../src/normalization-generation.js";
import {
  NORMALIZATION_OUTSIDE_DELEGATION,
  normalizationScopeGap,
  outsideNormalizationRoots,
  withNormalizationScopeGap,
} from "../src/normalization-scope-gap.js";
import { waitingConvergenceStage } from "../src/stage-receipt.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it("reduces excluded documents to the narrowest roots a delegation would need", () => {
  expect(
    outsideNormalizationRoots([
      "v4/DESIGN.md",
      "v4/DESIGN/model.md",
      "v4/DESIGN/plan.md",
      "v4/README.md",
      "guides/setup/install.md",
      "NOTES.md",
    ]),
  ).toEqual(["NOTES.md", "guides/setup", "v4"]);
});

it("names the normalization roots a delegation excludes instead of an opaque authority failure", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  // The delegation normalizes `docs/specs` only; a new design tree stays outside it.
  await mkdir(resolve(f.root, "docs/guides/model"), { recursive: true });
  await writeFile(
    resolve(f.root, "docs/guides/design.md"),
    "# Design\n\nThe engine trades hourly.\n",
  );
  await writeFile(
    resolve(f.root, "docs/guides/model/policy.md"),
    "# Policy\n\nOne policy network.\n",
  );
  execFileSync("git", ["-C", f.root, "add", "docs/guides"]);
  execFileSync("git", [
    "-C",
    f.root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@lervo.invalid",
    "commit",
    "-qm",
    "guides",
  ]);
  // The in-scope document was already rejected at its current bytes, so only excluded work remains.
  const runtime = sha256(await readFile(resolve(f.root, "docs/specs/runtime.md")));
  const delegationHash = sha256(
    await readFile(resolve(f.root, ".lervo/knowledge/convergence-delegation.json")),
  );
  const state = {
    schemaVersion: 1,
    obligationId: "kconv_0123456789abcdef01234567",
    snapshotHash: sha256("snapshot"),
    receipts: [],
    baseline: {
      projectId: f.storage.manifest.projectId,
      delegationHash,
      sources: await Promise.all(
        ["docs/guides/design.md", "docs/guides/model/policy.md", "docs/specs/runtime.md"].map(
          async (path) => ({
            path,
            contentHash: sha256(await readFile(resolve(f.root, path))),
            kind: "text",
          }),
        ),
      ),
    },
    stageData: { normalizationRejected: { "docs/specs/runtime.md": runtime } },
  } as unknown as KnowledgeConvergenceInput;
  const result = await generateNormalizationBatch(
    {
      storage: f.storage,
      provider: "claude",
      executable: f.executable,
      signal: new AbortController().signal,
      liveWorkPending: async () => false,
      assertSource: () => undefined,
    },
    state,
    () => undefined,
  );
  expect(result).toMatchObject({
    state: "waiting_authority",
    failureCode: "knowledge_normalization_outside_delegation",
  });
  const bytes = await f.artifacts.get(`lervo-cas://sha256/${result.dependencyHash!.slice(7)}`);
  expect(JSON.parse(Buffer.from(bytes).toString("utf8"))).toEqual({
    schemaVersion: 1,
    kind: "normalization_scope",
    code: "knowledge_normalization_outside_delegation",
    snapshotHash: sha256("snapshot"),
    delegationHash,
    pendingDocuments: 2,
    outsideRoots: ["docs/guides"],
    paths: ["docs/guides/design.md", "docs/guides/model/policy.md"],
    evaluationContract: expect.stringMatching(/^adr-0485:[a-f0-9]{24}$/u),
  });
  await expect(readFile(f.log)).rejects.toMatchObject({ code: "ENOENT" });
});

it("adds the excluded roots to the waiting status from the exact stored dependency", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const paths = ["v4/DESIGN.md", "v4/DESIGN/model.md", "v4/README.md"];
  const baseline: KnowledgeConvergenceBaseline = {
    schemaVersion: 1,
    projectId: f.storage.manifest.projectId,
    sourceSnapshotId: "ksnap_fixture",
    sourceSnapshotHash: sha256("source"),
    policyHash: sha256("policy"),
    debtDigest: sha256("debt"),
    delegationHash: sha256("delegation"),
    debtCounts: { canonicalization: 0, normalization: 3, lifecycle: 0, historical: 0 },
    sources: [],
    normalizationPaths: paths,
    historicalEvents: [],
  };
  const status = await processKnowledgeConvergence({
    events: f.storage.events,
    artifacts: f.storage.artifacts,
    workerId: "fixture",
    writableEventSchemaVersion: 4,
    maximumStages: 1,
    host: {
      discover: async () => baseline,
      assertCurrent: async () => undefined,
      assertSettlement: () => undefined,
      dependencyCurrent: async () => true,
      runStage: async (_stage, input) =>
        waitingConvergenceStage({
          artifacts: f.storage.artifacts,
          state: input,
          reason: NORMALIZATION_OUTSIDE_DELEGATION,
          dependency: normalizationScopeGap(input, paths),
        }),
    },
  });
  expect(status).toMatchObject({
    state: "waiting_authority",
    reason: "knowledge_normalization_outside_delegation",
  });
  expect(status.scopeGap).toBeUndefined();
  expect(await withNormalizationScopeGap(f.storage, status)).toMatchObject({
    scopeGap: { pendingDocuments: 3, outsideNormalizationRoots: ["v4"] },
  });
  // Another reason never reads a dependency or gains a scope gap.
  expect(
    await withNormalizationScopeGap(f.storage, { ...status, reason: "knowledge_lint_invalid" }),
  ).not.toHaveProperty("scopeGap");
});
