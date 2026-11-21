import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  assessCanonicalization,
  canonicalizationCandidateHeld,
  listCanonicalizationCandidates,
  sha256,
} from "@lervo/repository-knowledge";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function run(f: Awaited<ReturnType<typeof fixture>>) {
  return runAutonomousKnowledgeWorker({
    storage: f.storage,
    workerId: "deferral",
    provider: "claude",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
  });
}

it(
  "regenerates a deferred candidate review once, then holds it as Lervo debt without stopping (ADR-0561)",
  { timeout: 90_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    // The reviewer defers every candidate, as if it could not decide from the evidence.
    const script = await readFile(f.executable, "utf8");
    const deferring = script.replace(
      "decision:'reject',rationale:'The independently reviewed current source facts",
      "decision:'defer',rationale:'The independently reviewed current source facts",
    );
    expect(deferring).not.toBe(script);
    await writeFile(f.executable, deferring);
    await writeFile(resolve(f.root, "src.ts"), "export const deferredRuntime = true;\n");
    // An agent declared this change pending_user_approval; nobody waits for the owner.
    await assessCanonicalization({
      repositoryRoot: f.root,
      beforeRevision: sha256("before"),
      afterRevision: sha256("after"),
      beforeFiles: {},
      afterFiles: { "src.ts": sha256("export const deferredRuntime = true;\n") },
      disposition: "pending_user_approval",
      now: new Date(),
    });
    let result: Awaited<ReturnType<typeof run>>;
    for (let cycle = 0; cycle < 8; cycle++) {
      result = await run(f);
      if (result.status === "processed" && result.convergence.lastVerifiedCurrency) break;
    }
    expect(result!).toMatchObject({ convergence: { state: "idle" } });
    const [candidate] = await listCanonicalizationCandidates(f.root);
    expect(candidate).toMatchObject({ state: "pending", review: { decision: "defer" } });
    expect(canonicalizationCandidateHeld(candidate!)).toBe(true);
    const calls = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map(
        (line) =>
          JSON.parse(line) as {
            request: { task: string; untrustedSourceData?: { priorDeferral?: unknown } };
          },
      )
      .filter((call) => call.request.task === "canonical_candidate_resolution");
    // One review, one regeneration with the deferral as evidence, and then no further review.
    expect(calls.map((call) => call.request.untrustedSourceData?.priorDeferral ?? null)).toEqual([
      null,
      // ADR-0604: the deferral names the candidate by its reference, never its identifier.
      expect.objectContaining({ candidate: "k1" }),
    ]);
    await run(f);
    expect(
      (await readFile(f.log, "utf8"))
        .trim()
        .split("\n")
        .filter((line) => JSON.parse(line).request.task === "canonical_candidate_resolution"),
    ).toHaveLength(2);
  },
);
