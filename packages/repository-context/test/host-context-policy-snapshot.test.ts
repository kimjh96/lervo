import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createEventReaderCapabilities } from "@lervo/event-contract";
import {
  applyInitPlan,
  createInitPlan,
  planEventWriterActivation,
  applyEventWriterActivationPlan,
} from "@lervo/project";
import { canonicalHash } from "@lervo/search";
import { sha256 } from "@lervo/repository-knowledge";
import { observeHostContextOutcomes } from "../src/host-context-outcomes.js";
import { hostOutcomeTask } from "../src/host-context-task.js";
import type {
  HostContextOutcomeInput,
  HostOutcomeArtifact,
  HostOutcomeContract,
} from "../src/host-context-outcome-types.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-host-policy-snapshot-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_hostsnapshot" }));
  const evidence = {
    schemaVersion: 1,
    projectId: "prj_hostsnapshot",
    observedAt: new Date().toISOString(),
    readers: [
      {
        readerId: "reader_fixture01",
        readerKind: "local",
        peerIdentityHash: null,
        capabilities: createEventReaderCapabilities(),
      },
    ],
  };
  const plan = await planEventWriterActivation({
    repositoryRoot: root,
    evidence,
    targetEventSchemaVersion: 6,
  });
  await applyEventWriterActivationPlan({ plan, approval: plan.planId, currentEvidence: evidence });
  await writeFile(resolve(root, "result.txt"), "bad");
  await writeFile(resolve(root, "other.txt"), "good");
  const input: HostContextOutcomeInput = {
    repositoryRoot: root,
    origin: "managed_run",
    effects: "read_only",
    task: hostOutcomeTask("Write good", ["result.txt"]),
    artifacts: [{ kind: "repository", path: "result.txt" }],
  };
  const contract: HostOutcomeContract = {
    definition: {
      definitionId: "host.snapshot.v1",
      language: "en",
      preserveProtectedMaterial: false,
      task: {
        definitionId: "task.v1",
        taskDigest: canonicalHash(input.task),
        checks: [{ checkId: "result", requirement: "The content must be good." }],
      },
    },
    isPublication: false,
    requirePassed: true,
    taskEvaluator: {
      buildId: canonicalHash("fixture"),
      evaluate: async (request) => ({
        artifactDigest: request.artifactDigest,
        planDigest: request.planDigest,
        definitionHash: request.definitionHash,
        checks: [{ checkId: "result", status: request.content === "good" ? "passed" : "failed" }],
      }),
    },
  };
  return { input, contract };
}
it("does not let policy resolution redirect the admitted repository artifact", async () => {
  const { input, contract } = await fixture();
  input.policy = {
    resolve: async ({ artifact }) => {
      if (artifact.kind === "repository") artifact.path = "other.txt";
      return contract;
    },
  };
  const result = await observeHostContextOutcomes(input);
  expect(result.completionAllowed).toBe(false);
  expect(result.outcomes[0]?.observation).toMatchObject({
    disposition: "failed",
    artifactDigest: sha256(Buffer.from("bad")),
  });
});
it("retains immutable coordinates when a resolver reference changes during readback", async () => {
  const { input, contract } = await fixture();
  let exposed: HostOutcomeArtifact | undefined;
  let reads = 0;
  input.artifacts = [
    {
      kind: "immutable",
      artifactId: "art_snapshot",
      contentHash: sha256(Buffer.from("good")),
      byteCount: 4,
      readBytes: async () => {
        reads++;
        if (reads === 2) {
          if (exposed?.kind === "immutable") exposed.contentHash = sha256(Buffer.from("evil"));
          return Buffer.from("evil");
        }
        return Buffer.from("good");
      },
    },
  ];
  input.policy = {
    resolve: async ({ artifact }) => {
      exposed = artifact;
      return contract;
    },
  };
  const result = await observeHostContextOutcomes(input);
  expect(reads).toBe(2);
  expect(result.completionAllowed).toBe(false);
  expect(result.outcomes[0]?.observation?.disposition).not.toBe("passed");
});
it("pins the admitted definition before an immutable artifact callback runs", async () => {
  const { input, contract } = await fixture();
  const definitionHash = canonicalHash(contract.definition);
  input.artifacts = [
    {
      kind: "immutable",
      artifactId: "art_snapshot",
      contentHash: sha256(Buffer.from("good")),
      byteCount: 4,
      readBytes: async () => {
        contract.definition.definitionId = "changed.after.admission";
        return Buffer.from("good");
      },
    },
  ];
  input.policy = { resolve: async () => contract };
  const result = await observeHostContextOutcomes(input);
  expect(result.completionAllowed).toBe(true);
  expect(result.outcomes[0]?.observation?.verificationDefinitionHash).toBe(definitionHash);
});
it("keeps the admitted policy resolver for later artifacts", async () => {
  const { input, contract } = await fixture();
  input.artifacts = [
    { kind: "repository", path: "other.txt" },
    { kind: "repository", path: "result.txt" },
  ];
  input.policy = {
    resolve: async () => {
      input.policy!.resolve = async () => ({ ...contract, requirePassed: false });
      return contract;
    },
  };
  const result = await observeHostContextOutcomes(input);
  expect(result.observedCount).toBe(2);
  expect(result.outcomes.map((outcome) => outcome.observation?.disposition)).toEqual([
    "passed",
    "failed",
  ]);
  expect(result.completionAllowed).toBe(false);
});
it("pins the task evaluator before artifact I/O", async () => {
  const { input, contract } = await fixture();
  input.artifacts = [
    {
      kind: "immutable",
      artifactId: "art_snapshot",
      contentHash: sha256(Buffer.from("bad")),
      byteCount: 3,
      readBytes: async () => {
        contract.taskEvaluator!.evaluate = async (request) => ({
          artifactDigest: request.artifactDigest,
          planDigest: request.planDigest,
          definitionHash: request.definitionHash,
          checks: [{ checkId: "result", status: "passed" }],
        });
        return Buffer.from("bad");
      },
    },
  ];
  input.policy = { resolve: async () => contract };
  const result = await observeHostContextOutcomes(input);
  expect(result.completionAllowed).toBe(false);
  expect(result.outcomes[0]?.observation?.disposition).toBe("failed");
});
it("keeps correction ranges fixed while the initial evaluator runs", async () => {
  const { input, contract } = await fixture();
  input.effects = "owner_controlled";
  let applied = 0;
  contract.correction = {
    maximumAttempts: 1,
    deadlineMs: 5000,
    editable: {
      artifactDigest: sha256(Buffer.from("bad")),
      ranges: [{ startByte: 0, endByte: 0 }],
    },
    propose: async () => [{ startByte: 0, endByte: 3, replacement: "good" }],
    apply: async (effect) => {
      applied++;
      await effect.assertCurrent();
      await writeFile(resolve(input.repositoryRoot, effect.artifactPath), effect.bytes);
      return "applied";
    },
  };
  const evaluate = contract.taskEvaluator!.evaluate;
  contract.taskEvaluator!.evaluate = async (request) => {
    contract.correction!.editable.ranges[0]!.endByte = 3;
    return evaluate(request);
  };
  input.policy = { resolve: async () => contract, verifyAfterCorrection: async () => undefined };
  const result = await observeHostContextOutcomes(input);
  expect(result.completionAllowed).toBe(false);
  expect(applied).toBe(0);
  expect(await readFile(resolve(input.repositoryRoot, "result.txt"), "utf8")).toBe("bad");
});
it("preserves callback receivers while capturing policy and evaluator methods", async () => {
  const { input, contract } = await fixture();
  const evaluate = contract.taskEvaluator!.evaluate;
  const evaluator = {
    buildId: contract.taskEvaluator!.buildId,
    expected: "good",
    async evaluate(request: Parameters<typeof evaluate>[0]) {
      expect(this.expected).toBe("good");
      return evaluate(request);
    },
  };
  contract.taskEvaluator = evaluator;
  const policy = {
    contract,
    async resolve() {
      return this.contract;
    },
  };
  const artifact = {
    kind: "immutable" as const,
    artifactId: "art_snapshot",
    contentHash: sha256(Buffer.from("good")),
    byteCount: 4,
    bytes: Buffer.from("good"),
    async readBytes() {
      return this.bytes;
    },
  };
  input.policy = policy;
  input.artifacts = [artifact];
  const result = await observeHostContextOutcomes(input);
  expect(result.completionAllowed).toBe(true);
  expect(result.outcomes[0]?.observation?.disposition).toBe("passed");
});
