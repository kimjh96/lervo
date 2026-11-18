import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { DocumentRouteClassificationRequest } from "@lervo/repository-knowledge";
import { KnowledgeConvergenceRuntimeError } from "../../../packages/repository-knowledge-runtime/src/failure.js";
import { pauseKnowledgeProvider } from "../../../packages/repository-knowledge-runtime/src/provider-admission.js";
import { runCli } from "../src/main.js";
import { commitRepository } from "./committed-repository.js";
import { planCrossCheck } from "./plan-cross-check-fixture.js";

const provider = vi.hoisted(() => ({
  calls: [] as unknown[],
  admitted: true,
  released: 0,
  fail: false,
  realAdmissionDirectory: null as string | null,
  admissionError: null as string | null,
  structuralCurrent: false,
  normalizationCalls: 0,
}));
vi.mock("@lervo/repository-knowledge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lervo/repository-knowledge")>();
  return {
    ...actual,
    createKnowledgeMigrationPlan: async (
      ...args: Parameters<typeof actual.createKnowledgeMigrationPlan>
    ) => {
      const plan = await actual.createKnowledgeMigrationPlan(...args);
      return provider.structuralCurrent
        ? {
            ...plan,
            operations: plan.operations.map((operation) => ({ ...operation, action: "unchanged" })),
          }
        : plan;
    },
    createKnowledgeInstructionBridgePlan: async (
      ...args: Parameters<typeof actual.createKnowledgeInstructionBridgePlan>
    ) =>
      provider.structuralCurrent
        ? { status: "current" }
        : actual.createKnowledgeInstructionBridgePlan(...args),
  };
});
vi.mock("../src/terminal-integration-stage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/terminal-integration-stage.js")>();
  return {
    ...actual,
    planTerminalIntegrationStage: async (
      ...args: Parameters<typeof actual.planTerminalIntegrationStage>
    ) =>
      provider.structuralCurrent
        ? { plan: { status: "current" } }
        : actual.planTerminalIntegrationStage(...args),
  };
});
vi.mock("../src/document-normalization-command.js", () => ({
  runDocumentNormalizationCommand: async () => {
    provider.normalizationCalls++;
    return 1;
  },
}));
vi.mock("@lervo/repository-knowledge-compiler", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lervo/repository-knowledge-compiler")>()),
  createNoCapabilityProviderJsonRunner: async () => ({
    resolveObserved: async (input: { untrustedSourceData: DocumentRouteClassificationRequest }) => {
      provider.calls.push(input);
      if (provider.fail) throw new Error("Provider unavailable");
      return {
        usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0, totalTokens: 20 },
        value: {
          classifications: input.untrustedSourceData.documents.map((document) => ({
            path: document.path,
            contentHash: document.contentHash,
            outcome: "route",
            routeId: "operations",
            roleId: null,
            rationale:
              "This document explains tracing and recovery procedures for service operators.",
          })),
        },
      };
    },
  }),
}));
vi.mock(
  "../../../packages/repository-knowledge-runtime/src/provider-admission.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../packages/repository-knowledge-runtime/src/provider-admission.js")
      >();
    return {
      ...actual,
      acquireKnowledgeProviderAdmission: async (
        input: Parameters<typeof actual.acquireKnowledgeProviderAdmission>[0],
      ) => {
        if (provider.admissionError !== null)
          throw new KnowledgeConvergenceRuntimeError(provider.admissionError);
        return provider.realAdmissionDirectory !== null
          ? actual.acquireKnowledgeProviderAdmission({
              ...input,
              directory: provider.realAdmissionDirectory,
            })
          : provider.admitted
            ? {
                observationHash: "sha256:" + "a".repeat(64),
                release: async () => {
                  provider.released++;
                },
              }
            : null;
      },
    };
  },
);
const roots: string[] = [];
afterEach(async () => {
  provider.calls.length = 0;
  provider.admitted = true;
  provider.released = 0;
  provider.fail = false;
  provider.realAdmissionDirectory = null;
  provider.admissionError = null;
  provider.structuralCurrent = false;
  provider.normalizationCalls = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-route-documents-"));
  roots.push(root);
  const messages: string[] = [];
  const errors: string[] = [];
  const io = {
    cwd: root,
    stdout: (message: string) => messages.push(message),
    stderr: (message: string) => errors.push(message),
  };
  expect(await runCli(["init"], io)).toBe(0);
  await writeFile(resolve(root, "AGENTS.md"), "# Instructions\n\nPreserve user content.\n");
  await writeFile(
    resolve(root, "TRACE.md"),
    "# Trace\n\nInspect service traces before restarting.\n",
  );
  messages.length = 0;
  return { root, io, messages, errors };
}

it("classifies TRACE during migrate --provider and applies its move after an independent cross-check", async () => {
  const { root, io, messages, errors } = await fixture();
  expect(
    await runCli(["migrate", "knowledge", "--provider", "codex", "--json"], io),
    errors.join(""),
  ).toBe(0);
  const plan = JSON.parse(messages.join(""));
  expect(plan.moves).toContainEqual(
    expect.objectContaining({
      fromPath: "TRACE.md",
      toPath: "docs/operations/TRACE.md",
      classificationBasis: "semantic_provider",
    }),
  );
  expect(plan.deferredDocuments).toEqual([]);
  expect(provider.calls).toHaveLength(1);
  expect(provider.released).toBe(1);
  await expect(access(resolve(root, "TRACE.md"))).resolves.toBeUndefined();
  await expect(access(resolve(root, "docs/operations/TRACE.md"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  messages.length = 0;
  // ADR-0561: the move lands as its own undo commit, so the moved document is committed first.
  commitRepository(root);
  const crossCheck = planCrossCheck();
  expect(
    await runCli(
      ["migrate", "knowledge", "--apply", plan.planId, "--provider", "codex", "--json"],
      io,
      crossCheck.services,
    ),
    errors.join(""),
  ).toBe(0);
  // The cross-check runs in the named provider, separate from the classification call.
  expect(crossCheck.checked).toEqual([expect.objectContaining({ provider: "codex" })]);
  expect(await readFile(resolve(root, "docs/operations/TRACE.md"), "utf8")).toContain(
    "Inspect service traces",
  );
  expect(provider.calls).toHaveLength(1);
});

it.each(["absent", "not_admitted", "failed"] as const)(
  "keeps TRACE explicit and coverage incomplete when the provider is %s",
  async (state) => {
    const { io, messages } = await fixture();
    provider.admitted = state !== "not_admitted";
    provider.fail = state === "failed";
    expect(
      await runCli(
        ["migrate", "knowledge", ...(state === "absent" ? [] : ["--provider", "codex"]), "--json"],
        io,
      ),
    ).toBe(0);
    const plan = JSON.parse(messages.join(""));
    expect(plan.coverage.complete).toBe(false);
    expect(plan.deferredDocuments).toContainEqual(
      expect.objectContaining({ path: "TRACE.md", resolution: "provider_unavailable" }),
    );
    if (state !== "failed") expect(provider.calls).toHaveLength(0);
    messages.length = 0;
    expect(await runCli(["migrate", "knowledge"], io)).toBe(0);
    expect(messages.join("")).toMatch(/^Deferred documents: 1\n/u);
    expect(messages.join("")).toContain("deferred [provider_unavailable] TRACE.md");
  },
);

it("bounds foreground classification to eight excerpts and leaves the remaining document explicit", async () => {
  const { root, io, messages } = await fixture();
  await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      writeFile(resolve(root, `Z-${index}.md`), `# Reference\n\n${"source ".repeat(2000)}`),
    ),
  );
  expect(await runCli(["migrate", "knowledge", "--provider", "codex", "--json"], io)).toBe(0);
  expect(provider.calls).toHaveLength(1);
  const call = provider.calls[0] as { untrustedSourceData: DocumentRouteClassificationRequest };
  expect(call.untrustedSourceData.documents).toHaveLength(8);
  expect(
    call.untrustedSourceData.documents.every(
      (document) => Buffer.byteLength(document.excerpt) <= 8192,
    ),
  ).toBe(true);
  const plan = JSON.parse(messages.join(""));
  expect(plan.moves).toHaveLength(8);
  expect(plan.deferredDocumentCount).toBe(1);
  expect(plan.coverage.complete).toBe(false);
});

it.each([false, true])(
  "returns provider_unavailable for real paused admission with structuralCurrent=%s",
  async (structuralCurrent) => {
    const { root, io, messages, errors } = await fixture();
    provider.structuralCurrent = structuralCurrent;
    const directory = resolve(root, ".lervo/state/test-provider-admission");
    await pauseKnowledgeProvider({
      provider: "codex",
      reason: "quota",
      observationHash: "sha256:" + "a".repeat(64),
      resetAt: null,
      directory,
    });
    provider.realAdmissionDirectory = directory;
    expect(
      await runCli(["migrate", "knowledge", "--provider", "codex", "--json"], io),
      errors.join(""),
    ).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      coverage: { complete: false },
      deferredDocuments: [
        expect.objectContaining({ path: "TRACE.md", resolution: "provider_unavailable" }),
      ],
    });
    expect(provider.calls).toHaveLength(0);
    expect(errors).toEqual([]);
    expect(provider.normalizationCalls).toBe(0);
  },
);

it.each(["knowledge_capacity_unavailable", "knowledge_provider_rejected"])(
  "keeps a plan available for known admission failure %s",
  async (code) => {
    const { io, messages } = await fixture();
    provider.admissionError = code;
    expect(await runCli(["migrate", "knowledge", "--provider", "codex", "--json"], io)).toBe(0);
    expect(JSON.parse(messages.join(""))).toMatchObject({
      coverage: { complete: false },
      deferredDocuments: [
        expect.objectContaining({ path: "TRACE.md", resolution: "provider_unavailable" }),
      ],
    });
    expect(provider.calls).toHaveLength(0);
  },
);

it("preserves unexpected admission errors instead of reporting provider unavailability", async () => {
  const { io, errors } = await fixture();
  provider.admissionError = "knowledge_authority_unavailable";
  expect(await runCli(["migrate", "knowledge", "--provider", "codex"], io)).toBe(1);
  expect(errors.join("")).toContain("knowledge_authority_unavailable");
  expect(provider.calls).toHaveLength(0);
});
