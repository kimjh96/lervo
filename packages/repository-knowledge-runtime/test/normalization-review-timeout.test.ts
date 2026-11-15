import { execFileSync } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";

import { halvedNormalizationDocumentLimit } from "../src/normalization-generation.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";
import { providerRequests } from "./convergence-parking-fixture.js";

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

/** Every stored suite-bound asset settlement in the project's private CAS. */
async function suiteBoundSettlements(directory: string) {
  const cas = resolve(directory, "sha256");
  return (
    await Promise.all(
      (await readdir(cas)).map(async (prefix) =>
        Promise.all(
          (await readdir(resolve(cas, prefix))).map((name) =>
            readFile(resolve(cas, prefix, name), "utf8"),
          ),
        ),
      ),
    )
  )
    .flat()
    .filter((text) => text.includes('"kind":"suite_bound_assets"'))
    .map(
      (text) => JSON.parse(text) as { sources: { path: string }[]; verificationReceipts: string[] },
    );
}

it(
  "reviews a halved stored subset after a review timeout, carries the halved limit into the next generation, and settles an undeclared opaque asset by the pinned suite",
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
    await writeFile(resolve(f.root, "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
    execFileSync("git", ["-C", f.root, "add", "."]);
    execFileSync("git", [
      "-C",
      f.root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@lervo.invalid",
      "commit",
      "-m",
      "add archive, storage and icon",
    ]);
    let result: Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>> | undefined;
    for (let cycle = 0; cycle < 30; cycle++) {
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
    expect(result).toMatchObject({
      status: "processed",
      convergence: { state: "idle", lastVerifiedCurrency: expect.any(Object) },
    });
    // One three-document batch timed out. Its stored one-document half is reviewed next, and each
    // later generation keeps the halved limit of one document.
    expect(timedOutBatches).toEqual([
      ["docs/specs/archive.md", "docs/specs/runtime.md", "docs/specs/storage.md"],
    ]);
    expect(
      (await providerRequests(f))
        .filter((request) => request.task === "independent_normalization_review")
        .map((request) =>
          (request.untrustedSourceData!.candidate as { items: { sourcePath: string }[] }).items.map(
            (item) => item.sourcePath,
          ),
        ),
    ).toEqual([["docs/specs/archive.md"], ["docs/specs/runtime.md"], ["docs/specs/storage.md"]]);
    const stages = f.events
      .list({ limit: 1_000, types: ["repository.knowledge.stage.recorded"] })
      .map(
        (event) => event.payload as { stage: string; state: string; failureCode: string | null },
      );
    for (const code of ["knowledge_job_transient_failure", "asset_verification_required"])
      expect(stages.some((stage) => stage.failureCode === code)).toBe(false);
    // The private suite-bound evidence names the exact asset bytes and the passing suite receipts.
    expect(await suiteBoundSettlements(f.storage.paths.cas)).toEqual([
      expect.objectContaining({
        sources: [expect.objectContaining({ path: "icon.png" })],
        verificationReceipts: [expect.stringMatching(/^sha256:/u)],
      }),
    ]);
  },
);
