import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { evaluateArtifactTask, type ArtifactTaskEvaluator } from "../src/artifact-task.js";
const hash = `sha256:${"a".repeat(64)}`;
const content = "Exact result";
const input = {
  definition: {
    definitionId: "task.v1",
    taskDigest: hash,
    checks: [{ checkId: "complete", requirement: "Complete the declared task." }],
  },
  artifactDigest: `sha256:${createHash("sha256").update(content).digest("hex")}`,
  planDigest: hash,
  content,
};
const evaluator: ArtifactTaskEvaluator = {
  buildId: hash,
  evaluate: async (request) => ({
    artifactDigest: request.artifactDigest,
    planDigest: request.planDigest,
    definitionHash: request.definitionHash,
    checks: request.definition.checks.map(({ checkId }) => ({ checkId, status: "passed" })),
  }),
};
it("binds every task verdict to exact content, plan, definition and evaluator", async () => {
  expect(await evaluateArtifactTask({ ...input, evaluator })).toMatchObject({
    disposition: "passed",
    evaluatorBuildId: hash,
  });
  expect((await evaluateArtifactTask(input)).disposition).toBe("unavailable");
});
it.each(["artifact", "plan", "definition", "missing", "duplicate", "unknown", "throw", "build"])(
  "rejects %s evaluator evidence",
  async (kind) => {
    const bad: ArtifactTaskEvaluator = {
      buildId: kind === "build" ? "invalid" : hash,
      evaluate: async (request) => {
        if (kind === "throw") throw new Error("private");
        const response = await evaluator.evaluate(request);
        if (kind === "artifact") response.artifactDigest = hash;
        if (kind === "plan") response.planDigest = input.artifactDigest;
        if (kind === "definition") response.definitionHash = hash;
        if (kind === "missing") response.checks = [];
        if (kind === "duplicate") response.checks.push(response.checks[0]!);
        if (kind === "unknown") response.checks[0]!.checkId = "unknown";
        return response;
      },
    };
    expect((await evaluateArtifactTask({ ...input, evaluator: bad })).disposition).toBe(
      "unavailable",
    );
  },
);
it("retains observed failures even with another unavailable required check", async () => {
  const definition = {
    ...input.definition,
    checks: [...input.definition.checks, { checkId: "other", requirement: "Another requirement." }],
  };
  const result = await evaluateArtifactTask({
    ...input,
    definition,
    evaluator: {
      ...evaluator,
      evaluate: async (request) => ({
        ...(await evaluator.evaluate(request)),
        checks: [
          { checkId: "complete", status: "failed" },
          { checkId: "other", status: "unavailable" },
        ],
      }),
    },
  });
  expect(result.disposition).toBe("failed");
});
it("does not pass tampered content or an empty definition", async () => {
  await expect(evaluateArtifactTask({ ...input, content: "changed" })).rejects.toThrow();
  await expect(
    evaluateArtifactTask({ ...input, definition: { ...input.definition, checks: [] } }),
  ).rejects.toThrow();
});
