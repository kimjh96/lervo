import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  NoCapabilityInvocationFailure,
  type NoCapabilityJsonInvocationStrategy,
} from "@lervo/adapter-contract";
import { providerOutputSchema } from "@lervo/schemas";
import { afterEach, expect, it, vi } from "vitest";

import {
  createNoCapabilityProviderJsonRunner,
  createProcessDocumentNormalizationCompiler,
  probeProviderCli,
  providerCliDispatchContext,
} from "../src/index.js";
import * as processHost from "../src/process-host.js";

afterEach(() => vi.restoreAllMocks());

const usage = {
  inputTokens: 7,
  cachedInputTokens: 1,
  outputTokens: 2,
  reasoningOutputTokens: 0,
  totalTokens: 9,
  contextWindow: null,
};

/** A strategy no provider ships: the compiler must work from the contract alone. */
function fakeStrategy(
  overrides: Partial<NoCapabilityJsonInvocationStrategy> = {},
): NoCapabilityJsonInvocationStrategy {
  return {
    provider: "codex",
    disabledCapabilities: ["fake-capability"],
    usageSemanticsId: "fake.usage.v1",
    admission: {
      kind: "model_call",
      arguments: ["admit"],
      stdin: "{}",
      usage: () => usage,
      assertAdmitted: () => undefined,
    },
    instructedRun: vi.fn((request) => ({
      arguments: ["instructed", request.reasoningEffort],
      files: [{ path: resolve(request.workingDirectory, "fake.json"), content: "fake" }],
    })),
    documentNormalizationRun: vi.fn(() => ({ arguments: ["normalize"], files: [] })),
    parseRun: vi.fn((stdout: string) => ({ result: JSON.parse(stdout), usage })),
    isNativeFailureEvent: (event) => event.fake === "failure",
    ...overrides,
  };
}

/** The fake process records each call and, while running, any strategy file it could read. */
function processReturning(
  stdout: string,
  strategyFile: () => string | undefined = () => undefined,
) {
  const seen: Array<{ arguments: readonly string[]; cwd: string; file?: string }> = [];
  const spy = vi.spyOn(processHost, "runProcess").mockImplementation(async (request) => {
    const file = strategyFile();
    seen.push({
      arguments: request.arguments,
      cwd: request.cwd,
      ...(file === undefined ? {} : { file }),
    });
    return {
      status: "completed",
      exitCode: 0,
      stderr: "",
      stdout: request.arguments[0] === "--version" ? "fake 1.0.0" : stdout,
    };
  });
  return { seen, spy };
}

const request = {
  task: "bounded_review",
  responseContract: {
    schemaVersion: 1,
    schema: providerOutputSchema({
      type: "object",
      properties: { tags: { type: "array", maxItems: 2, items: { type: "string" } } },
    }),
  },
};

it("runs the strategy's invocation and returns its result without capability telemetry", async () => {
  const strategy = fakeStrategy();
  const { seen } = processReturning('{"tags":["a"],"telemetry":{"toolCalls":9}}', () => {
    const directory = vi.mocked(strategy.instructedRun).mock.calls[0]?.[0].workingDirectory;
    const file = directory === undefined ? undefined : resolve(directory, "fake.json");
    return file !== undefined && existsSync(file) ? readFileSync(file, "utf8") : undefined;
  });
  const runner = await createNoCapabilityProviderJsonRunner({
    strategy,
    systemPrompt: "Review.",
    model: "fake-model",
  });
  expect(runner.provider).toBe("codex");
  await expect(runner.resolveObserved!(request)).resolves.toEqual({
    value: { tags: ["a"] },
    usage,
  });
  const run = vi.mocked(strategy.instructedRun).mock.calls[0]![0];
  expect(run).toMatchObject({
    reasoningEffort: "low",
    systemPrompt: "Review.",
    model: "fake-model",
    responseSchema: {
      requested: expect.stringContaining('"maxItems":2'),
      nativeSubset: expect.not.stringContaining("maxItems"),
    },
  });
  expect(seen[0]!.arguments).toEqual(["--version"]);
  expect(seen[1]).toMatchObject({ arguments: ["instructed", "low"], file: "fake" });
  expect(seen[1]!.cwd).toBe(providerCliDispatchContext().cwd);
  expect(existsSync(run.workingDirectory)).toBe(false);
});

it("translates a strategy failure into the same knowledge failure and details", async () => {
  processReturning("{}");
  const runner = await createNoCapabilityProviderJsonRunner({
    strategy: fakeStrategy({
      parseRun: () => {
        throw new NoCapabilityInvocationFailure("policy_violation", "Tool use observed.", {
          providerReportedFailure: true,
        });
      },
    }),
  });
  await expect(runner.resolve(request)).rejects.toMatchObject({
    name: "RepositoryKnowledgeError",
    code: "knowledge_compile_policy_violation",
    message: "Tool use observed.",
    providerReportedFailure: true,
  });
});

it("pauses on the strategy's native failure events only", async () => {
  processReturning('{"fake":"failure","error":{"message":"usage limit reached"}}');
  const runner = await createNoCapabilityProviderJsonRunner({ strategy: fakeStrategy() });
  await expect(runner.resolve(request)).rejects.toMatchObject({
    code: "knowledge_provider_paused",
    reason: "quota",
  });
});

it("normalizes with the native subset as the requested schema and zero telemetry", async () => {
  const strategy = fakeStrategy();
  const { seen } = processReturning('{"schemaVersion":1,"documents":[]}');
  const compiler = await createProcessDocumentNormalizationCompiler({ strategy });
  expect(compiler.descriptor).toMatchObject({
    compilerId: "lervo.codex.document-normalizer",
    provider: "codex",
  });
  const observed = await compiler.normalizeObserved!(
    { documents: [] } as never,
    new AbortController().signal,
  );
  expect(observed.response).toMatchObject({
    schemaVersion: 1,
    documents: [],
    telemetry: { toolCalls: 0, shellProcesses: 0, complete: true },
  });
  expect(observed.tokenUsage).toEqual({
    status: "observed",
    inputTokens: 7,
    cachedInputTokens: 1,
    outputTokens: 2,
    totalTokens: 9,
  });
  const run = vi.mocked(strategy.documentNormalizationRun).mock.calls[0]![0];
  expect(run.responseSchema.requested).toBe(run.responseSchema.nativeSubset);
  expect(run.instruction).toMatch(/^You are Lervo's repository document normalizer\./u);
  expect(seen[1]!.arguments).toEqual(["normalize"]);
});

it("admits through the strategy's model-input probe before any run", async () => {
  const assertNoModelTools = vi.fn(async () => {
    throw new NoCapabilityInvocationFailure("policy_violation", "Tools exposed.", {
      exposedTools: ["exec", "private-name"],
    });
  });
  const strategy = fakeStrategy({ admission: { kind: "model_input", assertNoModelTools } });
  processReturning("[]");
  await expect(createNoCapabilityProviderJsonRunner({ strategy })).rejects.toMatchObject({
    code: "knowledge_compile_policy_violation",
    exposedTools: ["exec", "private-name"],
  });
  await expect(probeProviderCli({ strategy, executable: "/fake" })).resolves.toEqual({
    admitted: false,
    reason: "capabilities_exposed",
    exposedTools: ["exec"],
  });
  expect(assertNoModelTools).toHaveBeenLastCalledWith(expect.any(Function), 30_000);
});
