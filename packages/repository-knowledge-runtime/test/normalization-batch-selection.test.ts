import { beforeEach, expect, it, vi } from "vitest";

import { createConfiguredDocumentNormalizationPreflight } from "@lervo/repository-knowledge";
import { selectNormalizationBatchWithinCallBudget } from "../src/normalization-batch-selection.js";

vi.mock("@lervo/repository-knowledge", () => ({
  createConfiguredDocumentNormalizationPreflight: vi.fn(),
}));

const preflight = vi.mocked(createConfiguredDocumentNormalizationPreflight);
const paths = Array.from({ length: 8 }, (_, index) => `docs/source-${index + 1}.md`);
const compiler = { descriptor: { kind: "test" } } as unknown as Parameters<
  typeof selectNormalizationBatchWithinCallBudget
>[0]["compiler"];

beforeEach(() => {
  preflight.mockReset();
});

it("keeps eight documents when the reviewed generator budget admits them", async () => {
  preflight.mockResolvedValue({ blockers: [] } as unknown as Awaited<ReturnType<typeof preflight>>);

  const selected = await selectNormalizationBatchWithinCallBudget({
    repositoryRoot: "/repo",
    paths,
    compiler,
    maximumSourceBytes: 1_000_000,
    maximumProviderCalls: 8,
  });

  expect(selected).toEqual(paths);
  expect(preflight).toHaveBeenCalledOnce();
  expect(preflight.mock.calls[0]?.[0].ceilings?.maximumProviderCalls).toBe(7);
});

it("narrows an eight-document miss-heavy batch before provider work", async () => {
  preflight.mockImplementation(
    async ({ sourcePaths }) =>
      ({
        selection: {
          documents: sourcePaths!.map((path) => ({ path, byteCount: 100, cache: "miss" })),
        },
        blockers:
          sourcePaths!.length > 5
            ? [{ code: "provider_calls_exceeded", observed: 12, limit: 7 }]
            : [],
      }) as unknown as Awaited<ReturnType<typeof preflight>>,
  );

  const selected = await selectNormalizationBatchWithinCallBudget({
    repositoryRoot: "/repo",
    paths,
    compiler,
    maximumSourceBytes: 1_000_000,
    maximumProviderCalls: 8,
  });

  expect(selected).toEqual(paths.slice(0, 5));
  expect(preflight).toHaveBeenCalledOnce();
});
