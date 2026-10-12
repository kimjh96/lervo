import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { sha256 } from "@lervo/repository-knowledge";
import {
  prepareRepositoryQualityContext,
  type RepositoryQualityInput,
} from "../src/repository-quality-context.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-quality-runtime-"));
  roots.push(root);
  await writeFile(
    resolve(root, "README.md"),
    "# Runtime\n## Background\n" +
      "noise ".repeat(500) +
      "\n## Cancellation\nDetach only the cancelled waiter.\n## Exceptions\nKeep shared work for other consumers.\n",
  );
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_qualityruntime" }));
  await mkdir(resolve(root, "docs/instructions/generated"), { recursive: true });
  const rulePath = `docs/instructions/generated/rule_${"a".repeat(24)}.md`;
  await writeFile(
    resolve(root, rulePath),
    "# Rule\nKeep exact source hashes.\n## Exceptions\nDo not equate missing observations with zero.\n",
  );
  const { readFile } = await import("node:fs/promises");
  const input: RepositoryQualityInput = {
    repositoryRoot: root,
    origin: "terminal",
    task: {
      intent: "cancellation",
      continuation: "",
      targetPaths: ["src/a.ts"],
      artifactKinds: ["source"],
      requestedActions: ["repository.read"],
      conversationLocale: "ko",
      publicationLocale: "en",
      retrievalLanguages: ["en"],
    },
    instructionMaximumBytes: 4096,
    evidenceMaximumBytes: 512,
    retrieval: "completed",
    candidates: [
      { path: "README.md", contentHash: sha256(await readFile(resolve(root, "README.md"))) },
    ],
    sourceSnapshotId: "snapshot_test",
    retrievalBuildId: "lexical_test_v1",
  };
  return { root, input, rulePath };
}
describe("production repository quality composition", () => {
  it("uses identical semantic plans across four surfaces without asserting delivery or corpus completeness", async () => {
    const { input } = await fixture();
    const results = [];
    for (const origin of ["terminal", "managed_run", "conversation", "native_chat"] as const)
      results.push(await prepareRepositoryQualityContext({ ...input, origin }));
    expect(new Set(results.map((value) => value.result.plan?.planDigest)).size).toBe(1);
    expect(new Set(results.map((value) => value.result.requestId)).size).toBe(4);
    for (const result of results) {
      expect(result.result.status).toBe("incomplete");
      expect(result.result.reasonCodes).toContain("context_corpus_incomplete");
      expect(result.result.reasonCodes).toContain("context_token_count_unavailable");
      expect(result.passages[0]!.content).toContain("Detach only the cancelled waiter.");
      expect(result.passages[0]!.content).toContain("Keep shared work for other consumers.");
      expect(result.passages[0]!.content).not.toContain("noise");
      expect(result.instructions?.context).toContain(
        "Do not equate missing observations with zero.",
      );
    }
  });
  it("rejects stale candidate bytes and invalid build observations", async () => {
    const { input, root } = await fixture();
    await writeFile(resolve(root, "README.md"), "Changed");
    expect((await prepareRepositoryQualityContext(input)).result.status).toBe("stale");
    expect(
      (await prepareRepositoryQualityContext({ ...input, retrievalBuildId: "" })).result,
    ).toMatchObject({
      status: "unavailable",
      plan: null,
      reasonCodes: ["context_binding_unavailable"],
    });
  });
  it("retains an applicable owner clause behind an out-of-scope replacement", async () => {
    const { input, root, rulePath } = await fixture();
    const ruleB = `rule_${"b".repeat(24)}`;
    const ruleC = `rule_${"c".repeat(24)}`;
    const descriptor = (metadata: string, body: string) =>
      `---\nlervo:\n  contextScope:\n    schemaVersion: 1\n${metadata}\n---\n${body}\n`;
    await writeFile(
      resolve(root, rulePath),
      descriptor(`    supersedes: [${ruleB}]`, "Retain the current owner clause."),
    );
    await writeFile(
      resolve(root, `docs/instructions/generated/${ruleB}.md`),
      descriptor(
        `    when:\n      paths: [\"docs/**\"]\n    supersedes: [${ruleC}]`,
        "Apply only to documentation.",
      ),
    );
    await writeFile(
      resolve(root, `docs/instructions/generated/${ruleC}.md`),
      "Keep exact source hashes.\n## Exceptions\nPreserve unavailable observations.\n",
    );
    const prepared = await prepareRepositoryQualityContext(input);
    expect(prepared.instructions?.context).toContain("Retain the current owner clause.");
    expect(prepared.instructions?.context).toContain("Keep exact source hashes.");
    expect(prepared.instructions?.context).toContain("Preserve unavailable observations.");
    expect(prepared.instructions?.context).not.toContain("Apply only to documentation.");
    expect(prepared.result.reasonCodes).not.toContain("context_rule_conflict");
  });
  it("changes bindings for a target edit and reevaluates canonical action exceptions", async () => {
    const { input, root, rulePath } = await fixture();
    await writeFile(
      resolve(root, rulePath),
      '---\nlervo:\n  contextScope:\n    schemaVersion: 1\n    when:\n      paths: ["src/**"]\n      requestedActions: [repository.write]\n    except:\n      - artifactKinds: [quotation]\n---\nKeep quoted content unchanged.\n',
    );
    const first = await prepareRepositoryQualityContext(input);
    const next = await prepareRepositoryQualityContext({
      ...input,
      task: { ...input.task, targetPaths: ["docs/a.md"] },
    });
    expect(first.result.plan?.semanticInputDigest).not.toBe(next.result.plan?.semanticInputDigest);
    const unresolved = await prepareRepositoryQualityContext({
      ...input,
      task: { ...input.task, requestedActions: [] },
    });
    expect(unresolved.result.reasonCodes).toContain("context_rule_unresolved");
  });
});

it("does not share authority across roots with the same project identifier", async () => {
  const first = await fixture();
  const second = await fixture();
  const [a, b] = await Promise.all([
    prepareRepositoryQualityContext(first.input),
    prepareRepositoryQualityContext(second.input),
  ]);
  expect(a.result.plan).not.toBeNull();
  expect(b.result.plan).not.toBeNull();
  expect(a.result.plan!.semanticInputDigest).not.toBe(b.result.plan!.semanticInputDigest);
});

it("revalidates current repository policy and candidate bytes around outcome verification", async () => {
  const { verifyRepositoryContextOutcome } = await import("../src/repository-context-outcome.js");
  const { input, root, rulePath } = await fixture();
  await writeFile(resolve(root, "outcome.md"), "# Result\nThe test passed.\n");
  const prepared = await prepareRepositoryQualityContext(input);
  expect(prepared.result.plan).not.toBeNull();
  const result = await verifyRepositoryContextOutcome({
    preparation: input,
    artifactPath: "outcome.md",
    planDigest: prepared.result.plan!.planDigest,
    definition: {
      definitionId: "publication.v1",
      language: "en",
      preserveProtectedMaterial: false,
    },
    isPublication: true,
    evaluator: {
      evaluate: async (request) => {
        await writeFile(resolve(root, rulePath), "# Changed policy\nRequire current approval.\n");
        return {
          evaluator: { kind: "human", evaluatorId: "test.review.v1" },
          checks: request.checks.map(({ checkId }) => ({
            checkId,
            status: "passed",
            violationCount: 0,
          })),
        };
      },
    },
  });
  expect(result.disposition).toBe("unavailable");
  expect(result.reasonCodes).toContain("context_binding_stale");
});

it("binds full task definitions to the current task and exposes bounded correction through the repository application", async () => {
  const { verifyRepositoryContextOutcome } = await import("../src/repository-context-outcome.js");
  const { correctRepositoryContextOutcome } =
    await import("../src/repository-context-correction.js");
  const { canonicalHash } = await import("@lervo/search");
  const { sha256 } = await import("@lervo/repository-knowledge");
  const { readFile } = await import("node:fs/promises");
  const { input, root } = await fixture();
  const path = resolve(root, "outcome.md");
  await writeFile(path, "bad");
  const prepared = await prepareRepositoryQualityContext(input);
  const definition = {
    definitionId: "task.outcome.v1",
    language: "en",
    preserveProtectedMaterial: false,
    task: {
      definitionId: "task.v1",
      taskDigest: canonicalHash(input.task),
      checks: [{ checkId: "result", requirement: "Produce the requested result." }],
    },
  };
  const outcome = {
    preparation: input,
    artifactPath: "outcome.md",
    planDigest: prepared.result.plan!.planDigest,
    definition,
    isPublication: false,
    taskEvaluator: {
      buildId: canonicalHash("test.task.v1"),
      evaluate: async (request: import("@lervo/verification").ArtifactTaskRequest) => ({
        artifactDigest: request.artifactDigest,
        planDigest: request.planDigest,
        definitionHash: request.definitionHash,
        checks: [
          {
            checkId: "result",
            status: request.content === "good" ? ("passed" as const) : ("failed" as const),
          },
        ],
      }),
    },
  };
  expect(
    (
      await verifyRepositoryContextOutcome({
        ...outcome,
        definition: {
          ...definition,
          task: { ...definition.task, taskDigest: canonicalHash("wrong task") },
        },
      })
    ).disposition,
  ).toBe("unavailable");
  const result = await correctRepositoryContextOutcome(outcome, {
    maximumAttempts: 1,
    deadlineMs: 5000,
    editable: {
      artifactDigest: sha256(Buffer.from("bad")),
      ranges: [{ startByte: 0, endByte: 3 }],
    },
    propose: async () => [{ startByte: 0, endByte: 3, replacement: "good" }],
    apply: async (effect) => {
      await effect.assertCurrent();
      effect.signal.throwIfAborted();
      if (sha256(await readFile(path)) !== effect.beforeDigest) return "conflict";
      await writeFile(path, effect.bytes);
      return "applied";
    },
  });
  expect(result.status).toBe("corrected");
  expect(result.observation?.disposition).toBe("passed");
});
