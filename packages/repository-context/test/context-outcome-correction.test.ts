import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalHash } from "@lervo/search";
import { sha256 } from "@lervo/repository-knowledge";
import type { ArtifactTaskEvaluator } from "@lervo/verification";
import { correctContextOutcome } from "../src/context-outcome-correction.js";
import type { ContextOutcomeInput } from "../src/context-outcome-types.js";
import type { ContextOutcomeCorrectionPorts } from "../src/context-outcome-correction-types.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const hash = `sha256:${"a".repeat(64)}`;
const taskEvaluator: ArtifactTaskEvaluator = {
  buildId: hash,
  evaluate: async (request) => ({
    artifactDigest: request.artifactDigest,
    planDigest: request.planDigest,
    definitionHash: request.definitionHash,
    checks: [{ checkId: "result", status: request.content.includes("good") ? "passed" : "failed" }],
  }),
};
async function fixture(content = "bad\n\n> original\n") {
  const repositoryRoot = await mkdtemp(resolve(tmpdir(), "lervo-correction-"));
  roots.push(repositoryRoot);
  const path = resolve(repositoryRoot, "result.md");
  await writeFile(path, content);
  const input: ContextOutcomeInput = {
    repositoryRoot,
    artifactPath: "result.md",
    planDigest: hash,
    definition: {
      definitionId: "result.v1",
      language: "en",
      preserveProtectedMaterial: true,
      task: {
        definitionId: "task.v1",
        taskDigest: hash,
        checks: [{ checkId: "result", requirement: "The result must be good." }],
      },
    },
    baselineBytes: Buffer.from(content),
    isPublication: false,
    taskEvaluator,
    assertPlanCurrent: async () => undefined,
  };
  const ports: ContextOutcomeCorrectionPorts = {
    maximumAttempts: 2,
    deadlineMs: 5000,
    editable: {
      artifactDigest: sha256(Buffer.from(content)),
      ranges: [{ startByte: 0, endByte: 3 }],
    },
    propose: vi.fn(async () => [{ startByte: 0, endByte: 3, replacement: "good" }]),
    apply: vi.fn(async (effect) => {
      await effect.assertCurrent();
      effect.signal.throwIfAborted();
      if (sha256(await readFile(path)) !== effect.beforeDigest) return "conflict";
      await writeFile(path, effect.bytes);
      return "applied";
    }),
  };
  return { input, ports, path, content };
}
it("verifies a draft before its exact authorized write and verifies final bytes again", async () => {
  const { input, ports, path } = await fixture();
  const result = await correctContextOutcome(input, ports);
  expect(result).toMatchObject({
    status: "corrected",
    attempts: 1,
    applied: true,
    observation: { disposition: "passed", scope: "task_and_artifact" },
  });
  expect(await readFile(path, "utf8")).toBe("good\n\n> original\n");
  expect(ports.apply).toHaveBeenCalledOnce();
});
it.each(["missing", "stale", "passed"])(
  "does not propose for %s initial evidence",
  async (kind) => {
    const { input, ports, path } = await fixture(kind === "passed" ? "good\n" : undefined);
    if (kind === "missing") delete input.taskEvaluator;
    if (kind === "stale") ports.editable.artifactDigest = hash;
    await correctContextOutcome(input, ports);
    expect(ports.propose).not.toHaveBeenCalled();
    expect(ports.apply).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe(kind === "passed" ? "good\n" : "bad\n\n> original\n");
  },
);
it("stops after the fixed attempt count and never writes failed proposals", async () => {
  const { input, ports, path, content } = await fixture();
  ports.propose = vi.fn(async () => [{ startByte: 0, endByte: 3, replacement: "bad" }]);
  expect(await correctContextOutcome(input, ports)).toMatchObject({
    status: "exhausted",
    attempts: 2,
    applied: false,
  });
  expect(ports.apply).not.toHaveBeenCalled();
  expect(await readFile(path, "utf8")).toBe(content);
});
it.each(["range", "protected"])("rejects unauthorized %s edits before writing", async (kind) => {
  const { input, ports, path, content } = await fixture();
  if (kind === "protected")
    ports.editable.ranges = [{ startByte: 0, endByte: Buffer.byteLength(content) }];
  ports.propose = async () => [
    { startByte: 0, endByte: Buffer.byteLength(content), replacement: "good\n> changed\n" },
  ];
  expect((await correctContextOutcome(input, ports)).status).toBe("rejected");
  expect(ports.apply).not.toHaveBeenCalled();
  expect(await readFile(path, "utf8")).toBe(content);
});
it.each(["denied", "conflict"] as const)(
  "retains %s effect refusal without a completion claim",
  async (status) => {
    const { input, ports, path, content } = await fixture();
    ports.apply = async () => status;
    const result = await correctContextOutcome(input, ports);
    expect(result.applied).toBe(false);
    expect(result.status).not.toBe("corrected");
    expect(await readFile(path, "utf8")).toBe(content);
  },
);
it("rejects a concurrent edit after a proposal and never overwrites it", async () => {
  const { input, ports, path } = await fixture();
  ports.propose = async () => {
    await writeFile(path, "owner edit");
    return [{ startByte: 0, endByte: 3, replacement: "good" }];
  };
  expect((await correctContextOutcome(input, ports)).status).toBe("unavailable");
  expect(ports.apply).not.toHaveBeenCalled();
  expect(await readFile(path, "utf8")).toBe("owner edit");
});
it("rejects a changed plan in the fenced apply operation", async () => {
  const { input, ports, path, content } = await fixture();
  let stale = false;
  input.assertPlanCurrent = async () => {
    if (stale) throw new Error("stale");
  };
  const apply = ports.apply;
  ports.apply = async (effect) => {
    stale = true;
    return apply(effect);
  };
  expect((await correctContextOutcome(input, ports)).status).toBe("unavailable");
  expect(await readFile(path, "utf8")).toBe(content);
});
it("never reuses candidate success after the effect writes different bytes", async () => {
  const { input, ports, path } = await fixture();
  ports.apply = async () => {
    await writeFile(path, "another good result");
    return "applied";
  };
  expect(await correctContextOutcome(input, ports)).toMatchObject({
    status: "unavailable",
    reason: "final_verification_failed",
    applied: true,
  });
});
it("stops on cancellation and does not apply a late proposal", async () => {
  const { input, ports } = await fixture();
  const controller = new AbortController();
  ports.signal = controller.signal;
  let complete:
    ((value: { startByte: number; endByte: number; replacement: string }[]) => void) | undefined;
  ports.propose = () =>
    new Promise((resolveProposal) => {
      complete = resolveProposal;
      controller.abort();
    });
  expect((await correctContextOutcome(input, ports)).status).toBe("cancelled");
  complete?.([{ startByte: 0, endByte: 3, replacement: "good" }]);
  await Promise.resolve();
  expect(ports.apply).not.toHaveBeenCalled();
});
it("enforces the deadline on an unavailable evaluator", async () => {
  const { input, ports } = await fixture();
  ports.deadlineMs = 20;
  input.taskEvaluator = { buildId: hash, evaluate: () => new Promise(() => undefined) };
  expect(await correctContextOutcome(input, ports)).toMatchObject({
    status: "cancelled",
    reason: "deadline",
    applied: false,
  });
  expect(ports.propose).not.toHaveBeenCalled();
  expect(ports.apply).not.toHaveBeenCalled();
});
it("binds the full definition passed to the proposer", async () => {
  const { input, ports } = await fixture();
  const propose = ports.propose;
  ports.propose = async (request) => {
    expect(canonicalHash(request.definition)).toBe(request.verificationDefinitionHash);
    request.definition.language = "tampered";
    return propose(request);
  };
  expect((await correctContextOutcome(input, ports)).status).toBe("corrected");
});
