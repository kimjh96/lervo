import { execFileSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";

import { halvedNormalizationDocumentLimit } from "../src/normalization-generation.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

const timedOutReviews: number[] = [];

vi.mock("../src/provider-call.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/provider-call.js")>();
  return {
    ...actual,
    reviewKnowledgeJson: async (input: Parameters<typeof actual.reviewKnowledgeJson>[0]) => {
      const items = (input.untrustedSourceData as { candidate?: { items?: unknown[] } }).candidate
        ?.items;
      // The installed failure: every review of a multi-document batch outran the runner timeout.
      if (input.task === "independent_normalization_review" && (items?.length ?? 0) > 1) {
        timedOutReviews.push(items!.length);
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
  "regenerates a smaller batch after a review timeout instead of retrying the same batch",
  { timeout: 300_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    await writeFile(
      resolve(f.root, "docs/specs/storage.md"),
      "# Storage\n\nThe runtime keeps durable history in the local event store.\n",
    );
    execFileSync("git", ["-C", f.root, "add", "docs/specs/storage.md"]);
    execFileSync("git", [
      "-C",
      f.root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@lervo.invalid",
      "commit",
      "-m",
      "add storage spec",
    ]);
    let result: Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>> | undefined;
    for (let cycle = 0; cycle < 20; cycle++) {
      result = await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `timeout-${cycle}`,
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
      });
      if (
        result.status === "processed" &&
        result.convergence.state === "idle" &&
        result.convergence.lastVerifiedCurrency !== null
      )
        break;
    }
    // One timed-out two-document batch, then single-document batches that complete.
    expect(timedOutReviews).toEqual([2]);
    expect(result).toMatchObject({
      status: "processed",
      convergence: { state: "idle", lastVerifiedCurrency: expect.any(Object) },
    });
    const stages = f.events
      .list({ limit: 1_000, types: ["repository.knowledge.stage.recorded"] })
      .map((event) => event.payload as { stage: string; state: string; failureCode: string });
    expect(stages.some((stage) => stage.failureCode === "knowledge_job_transient_failure")).toBe(
      false,
    );
    const reviews = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).request)
      .filter((request) => request.task === "independent_normalization_review");
    expect(reviews.map((request) => request.untrustedSourceData.candidate.items.length)).toEqual([
      1, 1,
    ]);
  },
);
