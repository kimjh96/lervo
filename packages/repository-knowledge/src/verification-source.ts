import type { EventEnvelope, VerificationResult, VerificationSuite } from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import {
  validateHistoricalVerificationResult,
  validateVerificationResult,
  verificationResultBytes,
  verificationSha256,
  verificationSuiteHash,
} from "@lervo/verification-contract";

import { recentVerificationCompletions } from "./verification-completions.js";
import { isUnverifiableEvidence } from "./evidence-read-errors.js";
import type { RepositorySupplementalSource } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

export const VERIFICATION_RESULT_SOURCE_ADAPTER = "verification-result-v1+event-cas";

const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_TOTAL_RESULT_BYTES = 16 * 1024 * 1024;

/**
 * The suite as the evidence root's checkout defines it, or null when that checkout has none, as
 * for a result recorded from another checkout's branch or a suite renamed or deleted since.
 */
export type LoadVerificationSuite = (suiteId: string) => Promise<VerificationSuite | null>;

function fail(): never {
  throw new RepositoryKnowledgeError(
    "knowledge_evidence_source_invalid",
    "The verification evidence source cannot be verified safely and completely.",
  );
}

type Unbindable = "fail" | "omit";

/**
 * Runs one read of recorded evidence, translating its failure into the evidence error. When
 * omitting, only a failure of the evidence itself is translated: a busy store or a bug surfaces
 * as itself, so it is never reported as unverifiable evidence (ADR-0649).
 */
async function evidenceRead<T>(unbindable: Unbindable, read: () => T | Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (unbindable === "omit" && !isUnverifiableEvidence(error)) throw error;
    return fail();
  }
}

interface VerificationSourceInput {
  events: Pick<EventStore, "latest" | "list">;
  artifacts: Pick<ArtifactStore, "get">;
  loadSuite: LoadVerificationSuite;
}

/** The verification results an interactive reader keeps, and how many it left out (ADR-0649). */
export interface TolerantVerificationResultSources {
  readonly sources: RepositorySupplementalSource[];
  /** Recorded results whose CAS original, suite file, or event binding could not be verified. */
  readonly omittedCount: number;
}

/**
 * Returns the recorded results of the most recent verifications through the observed head,
 * newest first within 16 MiB, in verification-ID order. Older results are left out rather than
 * failing (ADR-0554); every returned result is bound to its CAS original and event, and to its
 * current suite when the evidence root defines it unchanged. A result whose suite the evidence
 * root lacks or has changed is validated historically, as recorded (ADR-0649).
 */
export async function collectVerificationResultSources(
  input: VerificationSourceInput,
): Promise<RepositorySupplementalSource[]> {
  return (await collectVerifiedResults(input, "fail")).sources;
}

/**
 * ADR-0649: the same verified results for an interactive reader, such as `lervo knowledge query`,
 * that must still return rules. A result that cannot be bound, such as one whose CAS original is
 * gone, is left out and counted instead of failing the corpus. An unverifiable event history still
 * fails as `knowledge_evidence_source_invalid`, and a busy store or a bug throws as itself.
 */
export async function collectVerificationResultSourcesTolerantly(
  input: VerificationSourceInput,
): Promise<TolerantVerificationResultSources> {
  return collectVerifiedResults(input, "omit");
}

async function collectVerifiedResults(
  input: VerificationSourceInput,
  unbindable: Unbindable,
): Promise<TolerantVerificationResultSources> {
  const completions = await evidenceRead(unbindable, () => {
    const latest = input.events.latest();
    if (latest === null) return [];
    if (!Number.isSafeInteger(latest.seq) || latest.seq < 1) return fail();
    return recentVerificationCompletions(input.events, latest.seq);
  });

  const sources: RepositorySupplementalSource[] = [];
  let omittedCount = 0;
  let totalBytes = 0;
  for (const event of completions) {
    let source: RepositorySupplementalSource | "beyond_window";
    try {
      const [bytes, suite] = await boundResultInputs(event, input, unbindable);
      // The byte window keeps the newest results; this and every older result are left out.
      if (totalBytes + bytes.byteLength > MAX_TOTAL_RESULT_BYTES) source = "beyond_window";
      else {
        source = verifiedResultSource(event, bytes, suite);
        totalBytes += bytes.byteLength;
      }
    } catch (error) {
      if (unbindable === "fail" || !isUnverifiableEvidence(error)) throw error;
      omittedCount += 1;
      continue;
    }
    if (source === "beyond_window") break;
    sources.push(source);
  }
  return {
    sources: sources.sort((left, right) => left.path.localeCompare(right.path)),
    omittedCount,
  };
}

/** The completion's CAS original and, when the evidence root defines it, its current suite. */
async function boundResultInputs(
  event: EventEnvelope,
  input: VerificationSourceInput,
  unbindable: Unbindable,
): Promise<[Uint8Array, VerificationSuite | null]> {
  const payload = event.payload;
  const suiteId = payload.suiteId;
  const resultArtifactId = payload.resultArtifactId;
  const resultContentHash = payload.resultContentHash;
  if (
    typeof suiteId !== "string" ||
    typeof resultArtifactId !== "string" ||
    typeof resultContentHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(resultContentHash) ||
    resultArtifactId !== `art_${resultContentHash.slice("sha256:".length)}`
  )
    return fail();
  const uri = `lervo-cas://sha256/${resultContentHash.slice("sha256:".length)}`;
  const found = await evidenceRead(unbindable, () =>
    Promise.all([input.artifacts.get(uri), input.loadSuite(suiteId)]),
  );
  if (found[0].byteLength > MAX_RESULT_BYTES) return fail();
  return found;
}

function verifiedResultSource(
  event: EventEnvelope,
  bytes: Uint8Array,
  suite: VerificationSuite | null,
): RepositorySupplementalSource {
  const payload = event.payload;
  const verificationId = String(payload.verificationId);
  if (verificationSha256(bytes) !== payload.resultContentHash) return fail();
  let result: VerificationResult;
  try {
    result = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as VerificationResult;
    // A result recorded under an earlier suite definition stays bound to its own suite hash;
    // a later change to the suite must not invalidate every earlier result. A suite this root
    // lacks is the same case: the result stays bound to the suite hash it recorded (ADR-0649).
    if (suite !== null && verificationSuiteHash(suite) === payload.suiteHash)
      validateVerificationResult(result, suite);
    else validateHistoricalVerificationResult(result);
  } catch {
    return fail();
  }
  if (!Buffer.from(verificationResultBytes(result)).equals(Buffer.from(bytes))) return fail();
  if (
    result.verificationId !== verificationId ||
    result.suiteId !== payload.suiteId ||
    result.suiteHash !== payload.suiteHash ||
    result.repositoryRevision !== payload.repositoryRevision ||
    result.status !== payload.status ||
    result.completedAt !== event.occurredAt ||
    JSON.stringify(
      result.commands
        .filter((command) => command.status !== "passed")
        .map((command) => command.commandId),
    ) !== JSON.stringify(payload.nonPassedCommandIds)
  )
    return fail();
  return {
    path: `@verification/${verificationId}`,
    kind: "verification_result",
    classification: "ordinary",
    content: new TextDecoder().decode(bytes),
    origin: "verification_event_cas",
    unitKind: "verification",
    locator: `verification:${verificationId}`,
    title: `Verification ${result.suiteId}`,
    adapter: VERIFICATION_RESULT_SOURCE_ADAPTER,
  };
}
