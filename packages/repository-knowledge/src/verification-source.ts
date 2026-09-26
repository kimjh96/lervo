import type { VerificationResult, VerificationSuite } from "@lervo/schemas";
import { visitEventSnapshot, type ArtifactStore, type EventStore } from "@lervo/storage-contract";
import {
  validateHistoricalVerificationResult,
  validateVerificationResult,
  verificationResultBytes,
  verificationSha256,
  verificationSuiteHash,
} from "@lervo/verification-contract";

import type { RepositorySupplementalSource } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

export const VERIFICATION_RESULT_SOURCE_ADAPTER = "verification-result-v1+event-cas";

const MAX_EVENT_SEQUENCE = 100_000;
const MAX_RESULTS = 256;
const MAX_RESULT_BYTES = 1024 * 1024;
const MAX_TOTAL_RESULT_BYTES = 16 * 1024 * 1024;

export type LoadVerificationSuite = (suiteId: string) => Promise<VerificationSuite>;

function fail(): never {
  throw new RepositoryKnowledgeError(
    "knowledge_evidence_source_invalid",
    "The verification evidence source cannot be verified safely and completely.",
  );
}

export async function collectVerificationResultSources(input: {
  events: Pick<EventStore, "latest" | "list" | "verifyIntegrity">;
  artifacts: Pick<ArtifactStore, "get">;
  loadSuite: LoadVerificationSuite;
}): Promise<RepositorySupplementalSource[]> {
  let latest;
  try {
    const integrity = input.events.verifyIntegrity();
    if (!integrity.valid) return fail();
    latest = input.events.latest();
  } catch {
    return fail();
  }
  if (latest === null) return [];
  if (!Number.isSafeInteger(latest.seq) || latest.seq < 1 || latest.seq > MAX_EVENT_SEQUENCE)
    return fail();

  const completed = new Map<string, typeof latest>();
  try {
    visitEventSnapshot({
      events: input.events,
      throughSeq: latest.seq,
      visit: (event) => {
        if (event.type !== "verification.completed") return;
        const verificationId = event.payload.verificationId;
        if (typeof verificationId !== "string") return fail();
        const previous = completed.get(verificationId);
        if (
          previous !== undefined &&
          JSON.stringify(previous.payload) !== JSON.stringify(event.payload)
        )
          return fail();
        completed.set(verificationId, event);
        if (completed.size > MAX_RESULTS) return fail();
      },
    });
    if (!input.events.verifyIntegrity().valid) return fail();
  } catch {
    return fail();
  }

  const sources: RepositorySupplementalSource[] = [];
  let totalBytes = 0;
  for (const event of [...completed.values()].sort((left, right) =>
    String(left.payload.verificationId).localeCompare(String(right.payload.verificationId)),
  )) {
    const payload = event.payload;
    const verificationId = payload.verificationId;
    const suiteId = payload.suiteId;
    const resultArtifactId = payload.resultArtifactId;
    const resultContentHash = payload.resultContentHash;
    if (
      typeof verificationId !== "string" ||
      typeof suiteId !== "string" ||
      typeof resultArtifactId !== "string" ||
      typeof resultContentHash !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(resultContentHash) ||
      resultArtifactId !== `art_${resultContentHash.slice("sha256:".length)}`
    )
      return fail();
    const uri = `lervo-cas://sha256/${resultContentHash.slice("sha256:".length)}`;
    let bytes: Uint8Array;
    let suite: VerificationSuite;
    try {
      [bytes, suite] = await Promise.all([input.artifacts.get(uri), input.loadSuite(suiteId)]);
    } catch {
      return fail();
    }
    totalBytes += bytes.byteLength;
    if (bytes.byteLength > MAX_RESULT_BYTES || totalBytes > MAX_TOTAL_RESULT_BYTES) return fail();
    if (verificationSha256(bytes) !== resultContentHash) return fail();
    let result: VerificationResult;
    try {
      result = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as VerificationResult;
      // A result recorded under an earlier suite definition stays bound to its own suite hash;
      // a later change to the suite must not invalidate every earlier result.
      if (verificationSuiteHash(suite) === payload.suiteHash)
        validateVerificationResult(result, suite);
      else validateHistoricalVerificationResult(result);
    } catch {
      return fail();
    }
    if (!Buffer.from(verificationResultBytes(result)).equals(Buffer.from(bytes))) return fail();
    if (
      result.verificationId !== verificationId ||
      result.suiteId !== suiteId ||
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
    sources.push({
      path: `@verification/${verificationId}`,
      kind: "verification_result",
      classification: "ordinary",
      content: new TextDecoder().decode(bytes),
      origin: "verification_event_cas",
      unitKind: "verification",
      locator: `verification:${verificationId}`,
      title: `Verification ${suiteId}`,
      adapter: VERIFICATION_RESULT_SOURCE_ADAPTER,
    });
  }
  return sources;
}
