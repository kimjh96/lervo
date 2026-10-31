import { afterEach, expect, it, vi } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import { inspectEventWriterCoordinate } from "@lervo/project";
import { createBackgroundNormalizationCompiler } from "@lervo/repository-knowledge-runtime";
import {
  compileConfiguredDocumentNormalizationCandidateObserved,
  createConfiguredDocumentNormalizationPreflight,
  inspectConfiguredDocumentNormalization,
} from "@lervo/repository-knowledge";
import { NormalizationCandidatePreparer } from "../src/conversation-normalization-candidate.js";

vi.mock("@lervo/project-storage", () => ({ openProjectStorage: vi.fn() }));
vi.mock("@lervo/project", () => ({ inspectEventWriterCoordinate: vi.fn() }));
vi.mock("@lervo/repository-knowledge-runtime", () => ({
  createBackgroundNormalizationCompiler: vi.fn(),
}));
vi.mock("@lervo/repository-context", () => ({ collectLocalKnowledgeSources: async () => [] }));
vi.mock("@lervo/repository-knowledge", async (original) => ({
  ...(await original<typeof import("@lervo/repository-knowledge")>()),
  inspectConfiguredDocumentNormalization: vi.fn(),
  createConfiguredDocumentNormalizationPreflight: vi.fn(),
  compileConfiguredDocumentNormalizationCandidateObserved: vi.fn(),
  storeDocumentNormalizationCandidate: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

it("routes schema-3 conversation background normalization through shared admission and closes storage on rejection", async () => {
  const close = vi.fn(async () => {});
  const storage = { close };
  vi.mocked(openProjectStorage).mockResolvedValue(storage as never);
  vi.mocked(inspectEventWriterCoordinate).mockResolvedValue({
    coordinate: { selectedEventSchemaVersion: 3 },
  } as never);
  vi.mocked(inspectConfiguredDocumentNormalization).mockResolvedValue({
    pendingDocuments: [{ path: "docs/pending.md" }],
  } as never);
  vi.mocked(createBackgroundNormalizationCompiler).mockRejectedValue(
    Object.assign(new Error("provider_not_admitted"), { code: "provider_not_admitted" }),
  );
  const preparer = new NormalizationCandidatePreparer({
    repositoryRoot: "/missing-repository-fixture",
    provider: "codex",
    executables: { codex: "/owner/codex" },
  });
  expect(await preparer.review()).toBeNull();
  await preparer.idle();
  expect(createBackgroundNormalizationCompiler).toHaveBeenCalledWith({
    storage,
    provider: "codex",
    executable: "/owner/codex",
  });
  expect(compileConfiguredDocumentNormalizationCandidateObserved).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
  await preparer.close();
});

it("keeps the admitted compiler descriptor when an allowed fallback generates a legacy candidate", async () => {
  const close = vi.fn(async () => {});
  vi.mocked(openProjectStorage).mockResolvedValue({ close } as never);
  vi.mocked(inspectEventWriterCoordinate).mockResolvedValue({
    coordinate: { selectedEventSchemaVersion: 3 },
  } as never);
  vi.mocked(inspectConfiguredDocumentNormalization).mockResolvedValue({
    pendingDocuments: [{ path: "docs/pending.md" }],
  } as never);
  const compiler = { descriptor: { provider: "claude", compilerBuildId: "admitted-identity" } };
  vi.mocked(createBackgroundNormalizationCompiler).mockResolvedValue(compiler as never);
  vi.mocked(createConfiguredDocumentNormalizationPreflight).mockResolvedValue({
    status: "ready",
    selection: { documents: [{ path: "docs/pending.md" }] },
  } as never);
  vi.mocked(compileConfiguredDocumentNormalizationCandidateObserved).mockResolvedValue({
    candidate: {},
  } as never);
  const preparer = new NormalizationCandidatePreparer({
    repositoryRoot: "/missing-repository-fixture",
    provider: "codex",
  });
  await preparer.review();
  await preparer.idle();
  expect(compileConfiguredDocumentNormalizationCandidateObserved).toHaveBeenCalledWith(
    expect.objectContaining({ compiler, ceilings: { maximumProviderCalls: 8 } }),
  );
  expect(close).toHaveBeenCalledTimes(1);
  await preparer.close();
});
