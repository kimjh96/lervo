import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";

import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import type { fixture } from "./fixture.js";

/** Readers and drivers shared by the end-to-end parking, canonical rejection, and timeout cases. */
type ConvergenceFixture = Awaited<ReturnType<typeof fixture>>;

export function runParkingWorker(f: ConvergenceFixture) {
  return runAutonomousKnowledgeWorker({
    storage: f.storage,
    workerId: "parking",
    provider: "claude",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
  });
}

/** Runs the real worker until the obligation reaches attention or verified currency. */
export async function settleParking(f: ConvergenceFixture, cycles = 16) {
  let result: Awaited<ReturnType<typeof runParkingWorker>> | undefined;
  for (let cycle = 0; cycle < cycles; cycle++) {
    result = await runParkingWorker(f);
    if (
      result.status === "processed" &&
      (result.convergence.state === "attention_required" ||
        (result.convergence.state === "idle" && result.convergence.lastVerifiedCurrency !== null))
    )
      break;
  }
  return result!;
}

/** Every request the fixture provider received, in call order. */
export async function providerRequests(f: ConvergenceFixture) {
  return (await readFile(f.log, "utf8"))
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line).request as {
          task?: string;
          envelope?: { documents: { path: string; independentReviewFeedback?: unknown }[] };
          untrustedSourceData?: Record<string, unknown>;
        },
    );
}

/** The source paths of each independent normalization review, in call order. */
export async function reviewedBatches(f: ConvergenceFixture) {
  return (await providerRequests(f))
    .filter((request) => request.task === "independent_normalization_review")
    .map((request) =>
      // ADR-0604: the reviewer sees the candidate's documents by reference.
      (
        request.untrustedSourceData!.candidate as { documents: { sourcePath: string }[] }
      ).documents.map((document) => document.sourcePath),
    );
}

/** Every generated envelope document that carried reviewer feedback, in call order. */
export async function regenerationFeedback(f: ConvergenceFixture) {
  return (await providerRequests(f))
    .flatMap((request) => request.envelope?.documents ?? [])
    .filter((document) => document.independentReviewFeedback !== undefined)
    .map(({ path, independentReviewFeedback }) => ({ path, independentReviewFeedback }));
}

/** Rewrites the fixture provider so the exact reviewer rejects selected sources. */
export async function rejectWhen(
  f: ConvergenceFixture,
  normalization: string,
  canonical = "false",
) {
  const script = await readFile(f.executable, "utf8");
  await writeFile(
    f.executable,
    script.replace(
      "console.log(JSON.stringify({is_error:false",
      `if(request.task==='independent_normalization_review'){for(const decision of response.decisions){const item=data.candidate.documents.find(source=>source.document===decision.document);if(${normalization}){decision.decision='reject';decision.checks.links=false;decision.rationale='The link to runtime.md#local-runtime loses its anchor in this rewrite.';}}}
if(request.task==='independent_canonical_review'&&(${canonical})){response.decision='reject';response.rationale='The workset claims coverage for docs/specs/b.md that no exact canonical quotation supports.';}
console.log(JSON.stringify({is_error:false`,
    ),
  );
}

/** The complete event history, read page by page. */
export function allEvents(events: OutboxStore) {
  const all = [];
  for (let page = events.list({ limit: 1_000 }); page.length;) {
    all.push(...page);
    page = events.list({ afterSeq: page.at(-1)!.seq, limit: 1_000 });
  }
  return all;
}

/** A JSON artifact the convergence runtime stored, read by its content hash. */
export async function casJson<T>(artifacts: ArtifactStore, hash: unknown): Promise<T> {
  return JSON.parse(
    Buffer.from(await artifacts.get(`lervo-cas://sha256/${(hash as string).slice(7)}`)).toString(
      "utf8",
    ),
  ) as T;
}

export function integrationRef(f: ConvergenceFixture) {
  return execFileSync("git", ["-C", f.root, "rev-parse", "refs/heads/knowledge-integration"], {
    encoding: "utf8",
  }).trim();
}

/** What a rejected canonical source must never produce: a canonicalize effect or currency. */
export function canonicalSettlementEffects(events: OutboxStore) {
  const history = allEvents(events);
  return {
    canonicalize: history.some(
      (event) =>
        event.type === "knowledge.materialization.applied" &&
        event.payload.operation === "canonicalize",
    ),
    current: history.some(
      (event) =>
        event.type === "repository.knowledge.convergence.recorded" &&
        event.payload.terminalState === "current",
    ),
  };
}
