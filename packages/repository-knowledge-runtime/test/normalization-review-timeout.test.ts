import { execFileSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";

import { halvedNormalizationDocumentLimit } from "../src/normalization-generation.js";
import { fixture } from "./fixture.js";
import { reviewedBatches, settleParking } from "./convergence-parking-fixture.js";

const timedOutBatches: string[][] = [];

vi.mock("../src/provider-call.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/provider-call.js")>();
  return {
    ...actual,
    reviewKnowledgeJson: async (input: Parameters<typeof actual.reviewKnowledgeJson>[0]) => {
      const items = (input.untrustedSourceData as { candidate?: { items?: unknown[] } }).candidate
        ?.items;
      // The installed failure: every review of a multi-document batch outran the runner timeout.
      if (input.task === "independent_normalization_review" && (items?.length ?? 0) > 1) {
        timedOutBatches.push((items as { sourcePath: string }[]).map((item) => item.sourcePath));
        throw Object.assign(
          new RepositoryKnowledgeError(
            "knowledge_compile_failed",
            "The provider JSON runner did not complete (timed_out).",
          ),
          { processStatus: "timed_out" },
        );
      }
      return actual.reviewKnowledgeJson(input);
    },
  };
});

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("halves the document limit down to one", () => {
  expect([8, 5, 2, 1].map(halvedNormalizationDocumentLimit)).toEqual([4, 2, 1, 1]);
});

it(
  "reviews the stored halved subset after a review timeout and carries the halved limit into the next generation",
  { timeout: 300_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    // The large document puts the first batch in a larger learned-cost class than the two small
    // ones, so only the obligation's halved limit, not the learned limit, bounds the next batch.
    await writeFile(
      resolve(f.root, "docs/specs/archive.md"),
      `# Archive\n\n${Array.from({ length: 44 }, (_, index) =>
        `Archived runtime record ${index} keeps the local event history readable.`
          .repeat(6)
          .replaceAll(".A", ". A"),
      ).join("\n\n")}\n`,
    );
    await writeFile(
      resolve(f.root, "docs/specs/storage.md"),
      "# Storage\n\nThe runtime keeps durable history in the local event store.\n",
    );
    execFileSync("git", ["-C", f.root, "add", "docs/specs"]);
    execFileSync("git", [
      "-C",
      f.root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@lervo.invalid",
      "commit",
      "-m",
      "add archive and storage specs",
    ]);
    expect(await settleParking(f, 30)).toMatchObject({
      status: "processed",
      convergence: { state: "idle", lastVerifiedCurrency: expect.any(Object) },
    });
    // One three-document batch timed out; every later review holds one document.
    expect(timedOutBatches).toEqual([
      ["docs/specs/archive.md", "docs/specs/runtime.md", "docs/specs/storage.md"],
    ]);
    expect(await reviewedBatches(f)).toEqual([
      ["docs/specs/archive.md"],
      ["docs/specs/runtime.md"],
      ["docs/specs/storage.md"],
    ]);
    const stages = f.events
      .list({ limit: 1_000, types: ["repository.knowledge.stage.recorded"] })
      .map(
        (event) => event.payload as { stage: string; state: string; failureCode: string | null },
      );
    expect(stages.some((stage) => stage.failureCode === "knowledge_job_transient_failure")).toBe(
      false,
    );
    // The timed-out review hands its stored first half straight to another review: no generation
    // runs between them, and the half is applied before the next generation.
    const normalization = stages
      .filter((stage) => stage.state === "current" && stage.stage.startsWith("normalization_"))
      .map((stage) => stage.stage);
    expect(normalization.slice(0, normalization.indexOf("normalization_apply") + 1)).toEqual([
      "normalization_generation",
      "normalization_review",
      "normalization_review",
      "normalization_apply",
    ]);
  },
);
