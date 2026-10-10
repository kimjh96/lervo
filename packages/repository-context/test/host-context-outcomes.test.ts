import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FileSystemCas } from "@lervo/cas";
import { createEventReaderCapabilities } from "@lervo/event-contract";
import {
  applyInitPlan,
  createInitPlan,
  planEventWriterActivation,
  applyEventWriterActivationPlan,
  planEventWriterRollback,
} from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import { canonicalHash } from "@lervo/search";
import { sha256 } from "@lervo/repository-knowledge";
import { observeHostContextOutcomes } from "../src/host-context-outcomes.js";
import { hostOutcomeTask } from "../src/host-context-task.js";
import type {
  HostContextOutcomeInput,
  HostOutcomeContract,
} from "../src/host-context-outcome-types.js";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(active = true) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-host-outcome-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_hostquality" }));
  if (active) {
    const evidence = {
      schemaVersion: 1,
      projectId: "prj_hostquality",
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
    await applyEventWriterActivationPlan({
      plan,
      approval: plan.planId,
      currentEvidence: evidence,
    });
  }
  await writeFile(resolve(root, "result.txt"), "bad");
  const input: HostContextOutcomeInput = {
    repositoryRoot: root,
    origin: "managed_run",
    effects: "owner_controlled",
    coordinates: { runId: "run_actualhost", sessionId: "ses_actualhost" },
    task: hostOutcomeTask("Write good", ["result.txt"]),
    artifacts: [{ kind: "repository", path: "result.txt", baselineBytes: Buffer.from("bad") }],
  };
  const contract: HostOutcomeContract = {
    definition: {
      definitionId: "host.acceptance.v1",
      language: "en",
      preserveProtectedMaterial: true,
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
  return { root, input, contract };
}
it("adds no artifact reads or quality events before explicit writer activation", async () => {
  const { root, input } = await fixture(false);
  const readBytes = vi.fn(async () => Buffer.from("good"));
  input.artifacts = [
    {
      kind: "immutable",
      artifactId: "art_fixture",
      byteCount: 4,
      contentHash: sha256(Buffer.from("good")),
      readBytes,
    },
  ];
  expect(await observeHostContextOutcomes(input)).toMatchObject({
    status: "writer_not_active",
    completionAllowed: true,
  });
  expect(readBytes).not.toHaveBeenCalled();
  const storage = await openProjectStorage(root);
  try {
    expect(
      storage.events.list({ types: ["context.quality.prepared", "context.quality.verified"] }),
    ).toHaveLength(0);
  } finally {
    await storage.close();
  }
});
it.each(["managed_run", "conversation", "native_chat", "terminal"] as const)(
  "records exact output and actual host coordinates for %s without claiming task acceptance",
  async (origin) => {
    const { root, input } = await fixture();
    const result = await observeHostContextOutcomes({ ...input, origin });
    expect(result).toMatchObject({ status: "observed", completionAllowed: true, observedCount: 1 });
    expect(result.outcomes[0]?.observation).toMatchObject({
      disposition: "unavailable",
      artifactDigest: sha256(Buffer.from("bad")),
      taskVerification: { disposition: "unavailable" },
    });
    const storage = await openProjectStorage(root);
    try {
      const events = storage.events.list({
        types: ["context.quality.prepared", "context.quality.verified"],
      });
      expect(events).toHaveLength(2);
      expect(
        events.every(
          (event) => event.runId === "run_actualhost" && event.sessionId === "ses_actualhost",
        ),
      ).toBe(true);
      expect(events[0]?.payload).toMatchObject({ originKind: origin, executionMode: "unmanaged" });
      expect(JSON.stringify(events)).not.toContain("Write good");
      expect(storage.events.verifyIntegrity().valid).toBe(true);
    } finally {
      await storage.close();
    }
  },
);
it("blocks required completion with missing verification, missing artifacts, or inactive recording", async () => {
  const { input, contract } = await fixture(false);
  input.policy = { resolve: async () => contract };
  expect((await observeHostContextOutcomes(input)).completionAllowed).toBe(false);
  expect((await observeHostContextOutcomes({ ...input, artifacts: [] })).completionAllowed).toBe(
    false,
  );
  delete contract.taskEvaluator;
  expect((await observeHostContextOutcomes(input)).completionAllowed).toBe(false);
});
it("checks immutable bytes twice and refuses stale CAS coordinates", async () => {
  const { input } = await fixture();
  const readBytes = vi
    .fn()
    .mockResolvedValueOnce(Buffer.from("good"))
    .mockResolvedValue(Buffer.from("evil"));
  const result = await observeHostContextOutcomes({
    ...input,
    artifacts: [
      {
        kind: "immutable",
        artifactId: "art_fixture",
        byteCount: 4,
        contentHash: sha256(Buffer.from("good")),
        readBytes,
      },
    ],
  });
  expect(result.outcomes[0]?.observation?.disposition ?? result.status).toBe("unavailable");
  expect(readBytes).toHaveBeenCalledTimes(2);
});
it.each(["read_only", "owner_controlled"] as const)(
  "uses only an admitted correction owner in %s",
  async (effects) => {
    const { root, input, contract } = await fixture();
    const path = resolve(root, "result.txt");
    const order: string[] = [];
    const apply = vi.fn(
      async (effect: Parameters<NonNullable<HostOutcomeContract["correction"]>["apply"]>[0]) => {
        await effect.assertCurrent();
        effect.signal.throwIfAborted();
        expect(sha256(await readFile(path))).toBe(effect.beforeDigest);
        order.push("apply");
        await writeFile(path, effect.bytes);
        return "applied" as const;
      },
    );
    contract.correction = {
      maximumAttempts: 1,
      deadlineMs: 5000,
      editable: {
        artifactDigest: sha256(Buffer.from("bad")),
        ranges: [{ startByte: 0, endByte: 3 }],
      },
      propose: async () => [{ startByte: 0, endByte: 3, replacement: "good" }],
      apply,
    };
    input.policy = {
      resolve: async () => contract,
      verifyAfterCorrection: async () => {
        order.push("project_verification");
      },
    };
    const report = await observeHostContextOutcomes({ ...input, effects });
    expect(report.completionAllowed).toBe(effects === "owner_controlled");
    expect(order).toEqual(effects === "owner_controlled" ? ["apply", "project_verification"] : []);
    expect(await readFile(path, "utf8")).toBe(effects === "owner_controlled" ? "good" : "bad");
    const storage = await openProjectStorage(root);
    try {
      const events = storage.events.list({ types: ["context.quality.verified"] });
      expect(events.map((event) => event.payload.disposition)).toEqual(
        effects === "owner_controlled" ? ["failed", "passed"] : ["failed"],
      );
    } finally {
      await storage.close();
    }
  },
);
it("suppresses new writes after rollback while retaining quality history", async () => {
  const { root, input } = await fixture();
  await observeHostContextOutcomes(input);
  const plan = await planEventWriterRollback(root);
  await applyEventWriterActivationPlan({ plan, approval: plan.planId });
  expect((await observeHostContextOutcomes(input)).status).toBe("writer_not_active");
  const storage = await openProjectStorage(root);
  try {
    expect(storage.events.list({ types: ["context.quality.verified"] })).toHaveLength(1);
  } finally {
    await storage.close();
  }
});
it.each(["throws", "changes_artifact"] as const)(
  "blocks completion when refreshed project verification %s",
  async (failure) => {
    const { root, input, contract } = await fixture();
    const path = resolve(root, "result.txt");
    contract.correction = {
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
        await writeFile(path, effect.bytes);
        return "applied";
      },
    };
    input.policy = {
      resolve: async () => contract,
      verifyAfterCorrection: async () => {
        if (failure === "throws") throw new Error("Project suite failed.");
        await writeFile(path, "changed after verification");
      },
    };
    const report = await observeHostContextOutcomes(input);
    expect(report.completionAllowed).toBe(false);
    expect(report.outcomes[0]?.correction?.applied).toBe(true);
    const storage = await openProjectStorage(root);
    try {
      expect(
        storage.events
          .list({ types: ["context.quality.verified"] })
          .some((event) => event.payload.disposition === "passed"),
      ).toBe(false);
    } finally {
      await storage.close();
    }
  },
);
it("rejects oversized artifact sets instead of silently truncating required coverage", async () => {
  const { input, contract } = await fixture();
  const resolveContract = vi.fn(async () => contract);
  const report = await observeHostContextOutcomes({
    ...input,
    artifacts: Array.from({ length: 65 }, () => input.artifacts[0]!),
    policy: { resolve: resolveContract },
  });
  expect(report).toMatchObject({
    reason: "capacity",
    artifactCount: 65,
    observedCount: 0,
    completionAllowed: false,
  });
  expect(resolveContract).not.toHaveBeenCalled();
});
it.each([true, false])(
  "binds a host language exception to the exact current plan and authority (%s)",
  async (authorized) => {
    const { root, input } = await fixture();
    const content = "결과를 확인했습니다.";
    await writeFile(resolve(root, "result.md"), content);
    input.artifacts = [
      { kind: "repository", path: "result.md", baselineBytes: Buffer.from(content) },
    ];
    input.task = hostOutcomeTask("Review this publication", ["result.md"]);
    const authorize = vi.fn(async () => authorized);
    input.policy = {
      resolve: async ({ planDigest, artifact }) => ({
        definition: {
          definitionId: "host.publication.v1",
          language: "en",
          preserveProtectedMaterial: true,
          languageException: {
            exceptionId: "reviewed.ko",
            ruleId: "writing_en-human",
            planDigest,
            artifactPath: artifact.kind === "repository" ? artifact.path : "",
            definitionId: "host.publication.v1",
            language: "ko",
            authorityEvidenceDigest: canonicalHash("current owner authority"),
          },
        },
        isPublication: true,
        requirePassed: true,
        authorizeLanguageException: authorize,
        evaluator: {
          evaluate: async (request) => ({
            evaluator: { kind: "model", evaluatorId: "fixture" },
            checks: request.checks.map((check) => ({
              checkId: check.checkId,
              status: "passed",
              violationCount: 0,
            })),
          }),
        },
      }),
    };
    const report = await observeHostContextOutcomes(input);
    expect(report.completionAllowed, JSON.stringify(report)).toBe(authorized);
    expect(report.outcomes[0]?.observation?.disposition).toBe(
      authorized ? "passed" : "unavailable",
    );
    expect(authorize).toHaveBeenCalled();
  },
);
it("blocks required completion when applicable instructions exceed the preparation bound", async () => {
  const { root, input, contract } = await fixture();
  await writeFile(resolve(root, "result.txt"), "good");
  await mkdir(resolve(root, "docs/instructions/generated"), { recursive: true });
  await writeFile(
    resolve(root, "docs/instructions/generated/rule_000000000000000000000001.md"),
    "Preserve every required instruction and its complete conditions. ".repeat(400),
  );
  input.policy = { resolve: async () => contract };
  const report = await observeHostContextOutcomes(input);
  expect(report.completionAllowed).toBe(false);
  const storage = await openProjectStorage(root);
  try {
    const prepared = storage.events.list({ types: ["context.quality.prepared"] });
    expect(prepared).toHaveLength(1);
    expect(["ready", "no_evidence"]).not.toContain(prepared[0]?.payload.status);
  } finally {
    await storage.close();
  }
});

it("overlaps the first artifact read but drains preparation before correction or completion", async () => {
  const { root, input, contract } = await fixture();
  let release!: () => void, readStarted!: () => void, writeStarted!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    readStarted = resolve;
  });
  const writing = new Promise<void>((resolve) => {
    writeStarted = resolve;
  });
  const originalPut = FileSystemCas.prototype.put;
  vi.spyOn(FileSystemCas.prototype, "put").mockImplementation(async function (
    this: FileSystemCas,
    content,
  ) {
    const body = JSON.parse(
      typeof content === "string" ? content : Buffer.from(content).toString("utf8"),
    );
    if (body.result?.requestId) {
      writeStarted();
      await gate;
    }
    return originalPut.call(this, content);
  });
  const originalEvaluate = contract.taskEvaluator!.evaluate;
  contract.taskEvaluator!.evaluate = async (request) => {
    readStarted();
    return originalEvaluate(request);
  };
  const propose = vi.fn(async () => [{ startByte: 0, endByte: 3, replacement: "good" }]);
  contract.correction = {
    maximumAttempts: 1,
    deadlineMs: 5000,
    editable: {
      artifactDigest: sha256(Buffer.from("bad")),
      ranges: [{ startByte: 0, endByte: 3 }],
    },
    propose,
    apply: async (effect) => {
      await effect.assertCurrent();
      await writeFile(resolve(root, "result.txt"), effect.bytes);
      return "applied";
    },
  };
  input.policy = { resolve: async () => contract, verifyAfterCorrection: async () => undefined };
  let completed = false;
  const pending = observeHostContextOutcomes(input).then((result) => {
    completed = true;
    return result;
  });
  await Promise.all([reading, writing]);
  expect(completed).toBe(false);
  expect(propose).not.toHaveBeenCalled();
  expect(await readFile(resolve(root, "result.txt"), "utf8")).toBe("bad");
  release();
  const result = await pending;
  expect(propose).toHaveBeenCalledOnce();
  expect(result.completionAllowed).toBe(true);
  const storage = await openProjectStorage(root);
  try {
    expect(
      storage.events
        .list({ types: ["context.quality.prepared", "context.quality.verified"] })
        .map((event) => event.type),
    ).toEqual(["context.quality.prepared", "context.quality.verified", "context.quality.verified"]);
    expect(storage.events.verifyIntegrity().valid).toBe(true);
  } finally {
    await storage.close();
  }
});
it("retains later artifact observations when the first policy resolution fails", async () => {
  const { root, input, contract } = await fixture();
  await writeFile(resolve(root, "result.txt"), "good");
  input.artifacts = [
    ...input.artifacts,
    {
      kind: "repository",
      path: "result.txt",
      baselineBytes: Buffer.from("good"),
    },
  ];
  const resolveContract = vi
    .fn()
    .mockRejectedValueOnce(new Error("first policy unavailable"))
    .mockResolvedValue(contract);
  input.policy = { resolve: resolveContract };
  const result = await observeHostContextOutcomes(input);
  expect(resolveContract).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({
    status: "unavailable",
    completionAllowed: false,
    observedCount: 1,
  });
  expect(result.outcomes[0]?.observation).toBeNull();
  expect(result.outcomes[1]?.observation?.disposition).toBe("passed");
});
