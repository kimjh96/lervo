import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";
import { SHA256_PATTERN, SOURCE_ID_PATTERN, type SearchEngineIdentity } from "@lervo/search";

import {
  listObservations,
  prepareObservationSubdirectory,
  readObservation,
  writeObservation,
} from "./observation-files.js";
import { SearchLocalError } from "./types.js";

export const LINKED_EVIDENCE_SHADOW_MAX_OBSERVATIONS = 10_000;
const OBSERVATION_FILE = /^lshadow_[a-f0-9]{24}\.json$/u;
const POLICY = { id: "linked-evidence-shadow", version: 1 } as const;

const failureCodes = [
  "shadow_bound_invalid",
  "shadow_contract_invalid",
  "shadow_record_limit_exceeded",
  "shadow_source_unavailable",
  "shadow_storage_failed",
] as const;

export type LinkedEvidenceShadowObservationFailureCode = (typeof failureCodes)[number];

export interface LinkedEvidenceShadowObservation {
  schemaVersion: 1;
  recordId: string;
  projectId: string;
  runId: string;
  observedAt: string;
  policy: typeof POLICY;
  engine: SearchEngineIdentity;
  indexId: string;
  sourceSnapshotId: string;
  selectionTransitionId: string | null;
  recommendationBatchId: string;
  resultSetHash: string;
  recommendationCount: number;
  candidateCount: number;
  retainedCount: number;
  ignoredCount: number;
  truncated: boolean;
  retainedByteCount: number;
  projectionDigest: string;
  retained: Array<{ documentId: string; contentHash: string }>;
  status: "observed" | "unavailable";
  failureCode: LinkedEvidenceShadowObservationFailureCode | null;
}

type ObservationInput = Omit<
  LinkedEvidenceShadowObservation,
  "policy" | "recordId" | "schemaVersion"
>;

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function exactKeys(value: unknown, expected: readonly string[]): value is object {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).toSorted().join("\0") === [...expected].toSorted().join("\0")
  );
}

function boundedCount(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function assertLinkedEvidenceShadowObservation(
  value: LinkedEvidenceShadowObservation,
): void {
  if (
    typeof value !== "object" ||
    value === null ||
    !exactKeys(value, [
      "candidateCount",
      "engine",
      "failureCode",
      "ignoredCount",
      "indexId",
      "observedAt",
      "policy",
      "projectId",
      "projectionDigest",
      "recommendationBatchId",
      "recommendationCount",
      "recordId",
      "resultSetHash",
      "retained",
      "retainedByteCount",
      "retainedCount",
      "runId",
      "schemaVersion",
      "selectionTransitionId",
      "sourceSnapshotId",
      "status",
      "truncated",
    ]) ||
    value.schemaVersion !== 1 ||
    !exactKeys(value.policy, ["id", "version"]) ||
    value.policy?.id !== POLICY.id ||
    value.policy.version !== POLICY.version ||
    !SOURCE_ID_PATTERN.test(value.projectId) ||
    !SOURCE_ID_PATTERN.test(value.runId) ||
    !canonicalTimestamp(value.observedAt) ||
    !exactKeys(value.engine, ["id", "version"]) ||
    !SOURCE_ID_PATTERN.test(value.engine?.id) ||
    !Number.isSafeInteger(value.engine.version) ||
    value.engine.version < 1 ||
    !SOURCE_ID_PATTERN.test(value.indexId) ||
    !SOURCE_ID_PATTERN.test(value.recommendationBatchId) ||
    !SHA256_PATTERN.test(value.resultSetHash) ||
    !SHA256_PATTERN.test(value.sourceSnapshotId) ||
    !SHA256_PATTERN.test(value.projectionDigest) ||
    (value.selectionTransitionId !== null &&
      !SOURCE_ID_PATTERN.test(value.selectionTransitionId)) ||
    !boundedCount(value.recommendationCount, 3) ||
    !boundedCount(value.candidateCount, 65_536) ||
    !boundedCount(value.retainedCount, 8) ||
    !boundedCount(value.ignoredCount, 65_536) ||
    typeof value.truncated !== "boolean" ||
    !boundedCount(value.retainedByteCount, 65_536) ||
    !Array.isArray(value.retained) ||
    value.retained.length !== value.retainedCount ||
    new Set(value.retained.map((item) => item.documentId)).size !== value.retained.length ||
    value.retained.some(
      (item) =>
        !exactKeys(item, ["contentHash", "documentId"]) ||
        !SOURCE_ID_PATTERN.test(item.documentId) ||
        !SHA256_PATTERN.test(item.contentHash),
    ) ||
    !["observed", "unavailable"].includes(value.status) ||
    (value.failureCode !== null && !failureCodes.includes(value.failureCode)) ||
    (value.status === "observed"
      ? value.failureCode !== null ||
        value.retainedCount > value.candidateCount ||
        value.truncated !== value.retainedCount < value.candidateCount
      : value.failureCode === null ||
        value.candidateCount !== 0 ||
        value.retainedCount !== 0 ||
        value.ignoredCount !== 0 ||
        value.truncated ||
        value.retainedByteCount !== 0 ||
        value.retained.length !== 0)
  ) {
    throw new SearchLocalError(
      "observation_invalid",
      "The linked-evidence shadow observation is invalid.",
    );
  }
  const { recordId: _recordId, ...core } = value;
  if (value.recordId !== `lshadow_${digest(core).slice("sha256:".length, 31)}`) {
    throw new SearchLocalError(
      "observation_invalid",
      "The linked-evidence shadow observation ID differs from its content.",
    );
  }
}

export function createLinkedEvidenceShadowObservation(
  input: ObservationInput,
): LinkedEvidenceShadowObservation {
  const core = { schemaVersion: 1 as const, ...structuredClone(input), policy: POLICY };
  const observation: LinkedEvidenceShadowObservation = {
    recordId: `lshadow_${digest(core).slice("sha256:".length, 31)}`,
    ...core,
  };
  assertLinkedEvidenceShadowObservation(observation);
  return observation;
}

export class LocalLinkedEvidenceShadowStore {
  private constructor(private readonly directory: string) {}

  static async open(repositoryRoot: string): Promise<LocalLinkedEvidenceShadowStore> {
    return new LocalLinkedEvidenceShadowStore(
      await prepareObservationSubdirectory(repositoryRoot, "linked-evidence-shadow"),
    );
  }

  async list(): Promise<LinkedEvidenceShadowObservation[]> {
    return listObservations({
      path: this.directory,
      pattern: OBSERVATION_FILE,
      assertValue: assertLinkedEvidenceShadowObservation,
      expectedFileName: (value) => `${value.recordId}.json`,
    });
  }

  async record(observation: LinkedEvidenceShadowObservation): Promise<void> {
    assertLinkedEvidenceShadowObservation(observation);
    const lockPath = resolve(this.directory, "..", ".linked-evidence-shadow.lock");
    let lock;
    try {
      lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      const observations = await this.list();
      const existing = observations.find((item) => item.runId === observation.runId);
      if (existing !== undefined) {
        if (existing.recordId === observation.recordId) return;
        throw new SearchLocalError(
          "observation_conflict",
          "A linked-evidence shadow observation already exists for this run.",
        );
      }
      if (observations.length >= LINKED_EVIDENCE_SHADOW_MAX_OBSERVATIONS) {
        throw new SearchLocalError(
          "observation_limit_exceeded",
          "The linked-evidence shadow observation limit was reached.",
        );
      }
      const target = resolve(this.directory, `${observation.recordId}.json`);
      await writeObservation(target, observation);
      const stored = await readObservation<LinkedEvidenceShadowObservation>(target);
      assertLinkedEvidenceShadowObservation(stored);
      if (canonicalJson(stored) !== canonicalJson(observation)) {
        throw new SearchLocalError(
          "observation_write_failed",
          "The linked-evidence shadow observation failed exact read-back validation.",
        );
      }
      if (process.platform !== "win32" && ((await stat(target)).mode & 0o777) !== 0o600) {
        throw new SearchLocalError(
          "observation_write_failed",
          "The linked-evidence shadow observation is not owner-only.",
        );
      }
    } catch (error) {
      if (error instanceof SearchLocalError) throw error;
      throw new SearchLocalError(
        "observation_write_failed",
        "Could not record the linked-evidence shadow observation.",
        { cause: error instanceof Error ? error : undefined },
      );
    } finally {
      await lock?.close();
      if (lock !== undefined) {
        try {
          await unlink(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            // Fail closed: an unreleased lock makes the observation state indeterminate.
            // eslint-disable-next-line no-unsafe-finally
            throw new SearchLocalError(
              "observation_write_failed",
              "Could not release the linked-evidence shadow observation lock.",
              { cause: error instanceof Error ? error : undefined },
            );
          }
        }
      }
    }
  }
}
