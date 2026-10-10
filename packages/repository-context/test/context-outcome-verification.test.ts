import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ContextQualityError } from "@lervo/context";
import type { WritingSemanticEvaluator } from "@lervo/writing";
import { verifyContextOutcome } from "../src/context-outcome-verification.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const evaluator: WritingSemanticEvaluator = {
  evaluate: async (request) => ({
    evaluator: { kind: "human", evaluatorId: "test.review.v1" },
    checks: request.checks.map(({ checkId }) => ({ checkId, status: "passed", violationCount: 0 })),
  }),
};
async function fixture() {
  const repositoryRoot = await mkdtemp(resolve(tmpdir(), "lervo-outcome-"));
  roots.push(repositoryRoot);
  const content = "# Results\nThe test passed.\n\n> 원문 유지\n\n```ts\nconst id = 1;\n```\n";
  await writeFile(resolve(repositoryRoot, "result.md"), content);
  return {
    repositoryRoot,
    artifactPath: "result.md",
    planDigest: `sha256:${"a".repeat(64)}`,
    definition: { definitionId: "publication.v1", language: "en", preserveProtectedMaterial: true },
    baselineBytes: Buffer.from(content),
    isPublication: true,
    evaluator,
    assertPlanCurrent: async () => undefined,
  };
}
it("binds English publication evaluation to artifact, definition and protected original bytes", async () => {
  const result = await verifyContextOutcome(await fixture());
  expect(result).toMatchObject({
    disposition: "passed",
    protectedMaterial: "passed",
    reasonCodes: [],
  });
  expect(result.writingEvaluationDigest).toMatch(/^sha256:/u);
});
it("does not pass without semantic evaluation or the protected baseline", async () => {
  const input = await fixture();
  const { evaluator: _evaluator, ...withoutEvaluator } = input;
  const { baselineBytes: _baseline, ...withoutBaseline } = input;
  expect((await verifyContextOutcome(withoutEvaluator)).disposition).toBe("unavailable");
  expect((await verifyContextOutcome(withoutBaseline)).disposition).toBe("unavailable");
});
it("rejects modified quotations even when a semantic evaluator would pass", async () => {
  const input = await fixture();
  await writeFile(
    resolve(input.repositoryRoot, input.artifactPath),
    "# Results\nThe test passed.\n\n> Translated quotation\n",
  );
  expect(await verifyContextOutcome(input)).toMatchObject({
    disposition: "failed",
    reasonCodes: ["context_protected_material_changed"],
  });
});
it("invalidates a verdict when the source plan changes during evaluation", async () => {
  const input = await fixture();
  let calls = 0;
  expect(
    await verifyContextOutcome({
      ...input,
      assertPlanCurrent: async () => {
        if (++calls === 2) throw new ContextQualityError("context_binding_stale");
      },
    }),
  ).toMatchObject({
    disposition: "unavailable",
    reasonCodes: expect.arrayContaining(["context_binding_stale"]),
  });
});
it("invalidates a verdict when the artifact changes during evaluation", async () => {
  const input = await fixture();
  const result = await verifyContextOutcome({
    ...input,
    evaluator: {
      evaluate: async (request) => {
        await writeFile(resolve(input.repositoryRoot, input.artifactPath), "changed");
        return evaluator.evaluate(request);
      },
    },
  });
  expect(result.disposition).toBe("unavailable");
  expect(result.reasonCodes).toContain("context_binding_stale");
});
it("leaves chat-only replies outside publication verification", async () => {
  expect(await verifyContextOutcome({ ...(await fixture()), isPublication: false })).toMatchObject({
    disposition: "not_applicable",
    reasonCodes: ["context_not_publication"],
  });
});
it("does not infer a non-English publication exception", async () => {
  const input = await fixture();
  expect(
    (await verifyContextOutcome({ ...input, definition: { ...input.definition, language: "ko" } }))
      .disposition,
  ).toBe("unavailable");
});
it("preserves known deterministic failures even if semantic evaluation cannot run", async () => {
  const input = await fixture();
  await writeFile(
    resolve(input.repositoryRoot, input.artifactPath),
    "# Results\nThis passed — with a forbidden dash.\n",
  );
  expect(
    (
      await verifyContextOutcome({
        ...input,
        definition: { ...input.definition, preserveProtectedMaterial: false },
      })
    ).disposition,
  ).toBe("failed");
});

it("rejects a hash-consistent observation that contradicts its claimed success", async () => {
  const { validContextOutcomeObservation } = await import("../src/context-outcome-observation.js");
  const { canonicalHash } = await import("@lervo/search");
  const observed = await verifyContextOutcome(await fixture());
  const { observationDigest: _digest, ...body } = observed;
  for (const patch of [
    { protectedMaterial: "failed" as const },
    { writingEvaluationDigest: null },
    { reasonCodes: ["context_verification_unavailable" as const] },
  ]) {
    const changed = { ...body, ...patch };
    expect(
      validContextOutcomeObservation({ ...changed, observationDigest: canonicalHash(changed) }),
    ).toBe(false);
  }
});

it("checks full task obligations independently of publication writing", async () => {
  const { canonicalHash } = await import("@lervo/search");
  const input = await fixture();
  const definition = {
    ...input.definition,
    task: {
      definitionId: "task.v1",
      taskDigest: canonicalHash("task"),
      checks: [{ checkId: "acceptance", requirement: "All requested behavior must be present." }],
    },
  };
  const checked = await verifyContextOutcome({
    ...input,
    definition,
    taskEvaluator: {
      buildId: canonicalHash("evaluator"),
      evaluate: async (request) => ({
        artifactDigest: request.artifactDigest,
        definitionHash: request.definitionHash,
        planDigest: request.planDigest,
        checks: [{ checkId: "acceptance", status: "failed" }],
      }),
    },
  });
  expect(checked).toMatchObject({
    schemaVersion: 2,
    scope: "task_and_artifact",
    disposition: "failed",
    taskVerification: { disposition: "failed" },
  });
  const missing = await verifyContextOutcome({ ...input, definition });
  expect(missing.disposition).toBe("unavailable");
});
it("applies only an exact authorized language exception and invalidates revoked authority", async () => {
  const input = await fixture();
  const definition = {
    ...input.definition,
    languageException: {
      exceptionId: "exception.ko",
      ruleId: "writing_en-human" as const,
      planDigest: input.planDigest,
      artifactPath: input.artifactPath,
      definitionId: input.definition.definitionId,
      language: "ko",
      authorityEvidenceDigest: input.planDigest,
    },
  };
  const evaluatorWithLocale: WritingSemanticEvaluator = {
    evaluate: async (request) => {
      expect(request.locale).toBe("ko");
      expect(request.checks.some((check) => check.checkId === "natural_en_prose")).toBe(false);
      return evaluator.evaluate(request);
    },
  };
  expect(
    await verifyContextOutcome({
      ...input,
      definition,
      evaluator: evaluatorWithLocale,
      authorizeLanguageException: async () => true,
    }),
  ).toMatchObject({ disposition: "passed", reasonCodes: ["context_language_exception"] });
  let authorizations = 0;
  expect(
    await verifyContextOutcome({
      ...input,
      definition,
      authorizeLanguageException: async () => ++authorizations === 1,
    }),
  ).toMatchObject({
    disposition: "unavailable",
    reasonCodes: expect.arrayContaining(["context_binding_stale"]),
  });
});
it("keeps legacy observation readers and rejects a forged full-task pass", async () => {
  const { validContextOutcomeObservation } = await import("../src/context-outcome-observation.js");
  const { canonicalHash } = await import("@lervo/search");
  const current = await verifyContextOutcome(await fixture());
  const {
    schemaVersion: _version,
    writingRequired: _writing,
    taskVerification: _task,
    languageExceptionDigest: _exception,
    observationDigest: _digest,
    ...body
  } = current;
  const legacy = {
    ...body,
    schemaVersion: 1 as const,
    scope: "publication_writing_and_protected_material" as const,
  };
  expect(
    validContextOutcomeObservation({ ...legacy, observationDigest: canonicalHash(legacy) }),
  ).toBe(true);
  const { observationDigest: _currentDigest, ...changed } = {
    ...current,
    scope: "task_and_artifact" as const,
  };
  expect(
    validContextOutcomeObservation({ ...changed, observationDigest: canonicalHash(changed) }),
  ).toBe(false);
});
