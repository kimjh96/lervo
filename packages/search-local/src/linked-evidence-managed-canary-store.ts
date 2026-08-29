import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";
import {
  managedLinkedEvidenceCanaryPolicy,
  managedLinkedEvidenceDeterministicSelectionPolicy,
  managedLinkedEvidenceSelectionProtocolDigest,
  type ManagedLinkedEvidenceCanaryFailureCode,
} from "@lervo/context";
import { SHA256_PATTERN, SOURCE_ID_PATTERN } from "@lervo/search";

import {
  listObservations,
  prepareObservationSubdirectory,
  readObservation,
  writeObservation,
} from "./observation-files.js";
import { SearchLocalError } from "./types.js";

export const LINKED_EVIDENCE_MANAGED_CANARY_MAX_RECORDS = 128;
const RECORD_FILE = /^lcanary_[a-f0-9]{24}\.json$/u;

export interface ManagedLinkedEvidenceUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

interface ManagedLinkedEvidenceCanaryRecordCore {
  recordId: string;
  canaryId: string;
  projectId: string;
  runId: string;
  providerArm: "codex" | "claude";
  policy: { id: typeof managedLinkedEvidenceCanaryPolicy.id; version: 1 };
  sourceSnapshotId: string;
  recommendationBatchId: string;
  selectionAttemptId: string;
  adapterReceiptId: string | null;
  contextDeliveryId: string | null;
  candidateCount: number;
  selectedCount: number;
  loadedCount: number;
  injectedCount: number;
  referencedCount: number;
  candidateDigest: string;
  selectedDigest: string;
  loadedDigest: string;
  injectedDigest: string;
  referencedDigest: string;
  selectedBytes: number;
  loadedBytes: number;
  injectedBytes: number;
  durationMs: number;
  usage: ManagedLinkedEvidenceUsageTotals | null;
  status: "completed" | "failed";
  failureCode: ManagedLinkedEvidenceCanaryFailureCode | null;
  recordedAt: string;
}

export interface ManagedLinkedEvidenceCanaryRecordV1 extends ManagedLinkedEvidenceCanaryRecordCore {
  schemaVersion: 1;
  protocol: {
    id: typeof managedLinkedEvidenceCanaryPolicy.selectionProtocolId;
    digest: string;
  };
  providerVisibleBytes: number;
}

export interface ManagedLinkedEvidenceCanaryRecordV2 extends ManagedLinkedEvidenceCanaryRecordCore {
  schemaVersion: 2;
  selectionPolicy:
    | {
        kind: "provider_turn";
        policyId: typeof managedLinkedEvidenceCanaryPolicy.selectionProtocolId;
        policyDigest: string;
      }
    | {
        kind: "deterministic_policy";
        policyId: string;
        policyDigest: string;
      };
  candidateBytes: number;
  selectionProviderVisibleBytes: number;
}

export type ManagedLinkedEvidenceCanaryRecord =
  ManagedLinkedEvidenceCanaryRecordV1 | ManagedLinkedEvidenceCanaryRecordV2;

type RecordInput = Omit<
  ManagedLinkedEvidenceCanaryRecordV2,
  "policy" | "recordId" | "schemaVersion"
>;

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function exactKeys(value: unknown, expected: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).toSorted().join("\0") === [...expected].toSorted().join("\0")
  );
}

function boundedInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

const failureCodes = new Set<ManagedLinkedEvidenceCanaryFailureCode>([
  "canary_not_eligible",
  "canary_selection_unavailable",
  "canary_selection_invalid",
  "canary_source_changed",
  "canary_delivery_unconfirmed",
  "canary_evidence_incomplete",
  "canary_storage_failed",
]);

function validUsage(value: ManagedLinkedEvidenceUsageTotals | null): boolean {
  return (
    value === null ||
    (exactKeys(value, [
      "cachedInputTokens",
      "inputTokens",
      "outputTokens",
      "reasoningOutputTokens",
      "totalTokens",
    ]) &&
      Object.values(value).every((item) => boundedInteger(item, Number.MAX_SAFE_INTEGER)) &&
      value.totalTokens === value.inputTokens + value.outputTokens)
  );
}

export function assertManagedLinkedEvidenceCanaryRecord(
  value: ManagedLinkedEvidenceCanaryRecord,
): void {
  const countKeys = [
    "candidateCount",
    "selectedCount",
    "loadedCount",
    "injectedCount",
    "referencedCount",
  ] as const;
  const legacy = value.schemaVersion === 1;
  const candidateBytes = legacy ? value.providerVisibleBytes : value.candidateBytes;
  const selectionProviderVisibleBytes = legacy
    ? value.providerVisibleBytes
    : value.selectionProviderVisibleBytes;
  const recordKeys = [
    "adapterReceiptId",
    "candidateCount",
    "candidateDigest",
    "canaryId",
    "contextDeliveryId",
    "durationMs",
    "failureCode",
    "injectedBytes",
    "injectedCount",
    "injectedDigest",
    "loadedBytes",
    "loadedCount",
    "loadedDigest",
    "policy",
    "projectId",
    "providerArm",
    "recommendationBatchId",
    "recordedAt",
    "recordId",
    "referencedCount",
    "referencedDigest",
    "runId",
    "schemaVersion",
    "selectedBytes",
    "selectedCount",
    "selectedDigest",
    "selectionAttemptId",
    "sourceSnapshotId",
    "status",
    "usage",
    ...(legacy
      ? ["protocol", "providerVisibleBytes"]
      : ["candidateBytes", "selectionPolicy", "selectionProviderVisibleBytes"]),
  ];
  const selectionPolicyValid = legacy
    ? exactKeys(value.protocol, ["digest", "id"]) &&
      value.protocol.id === managedLinkedEvidenceCanaryPolicy.selectionProtocolId &&
      value.protocol.digest === managedLinkedEvidenceSelectionProtocolDigest
    : exactKeys(value.selectionPolicy, ["kind", "policyDigest", "policyId"]) &&
      (value.selectionPolicy.kind === "provider_turn"
        ? value.selectionPolicy.policyId ===
            managedLinkedEvidenceCanaryPolicy.selectionProtocolId &&
          value.selectionPolicy.policyDigest === managedLinkedEvidenceSelectionProtocolDigest
        : value.selectionPolicy.kind === "deterministic_policy" &&
          value.selectionPolicy.policyId ===
            managedLinkedEvidenceDeterministicSelectionPolicy.policyId &&
          value.selectionPolicy.policyDigest ===
            managedLinkedEvidenceDeterministicSelectionPolicy.digest);
  const completedSelectionTelemetryValid =
    legacy || value.selectionPolicy.kind === "provider_turn"
      ? value.usage !== null && value.adapterReceiptId !== null
      : value.usage === null && value.adapterReceiptId === null;
  if (
    !exactKeys(value, recordKeys) ||
    ![1, 2].includes(value.schemaVersion) ||
    !SOURCE_ID_PATTERN.test(value.canaryId) ||
    !SOURCE_ID_PATTERN.test(value.projectId) ||
    !SOURCE_ID_PATTERN.test(value.runId) ||
    !SOURCE_ID_PATTERN.test(value.recommendationBatchId) ||
    !/^lsel_[a-f0-9]{24}$/u.test(value.selectionAttemptId) ||
    !["codex", "claude"].includes(value.providerArm) ||
    !exactKeys(value.policy, ["id", "version"]) ||
    value.policy.id !== managedLinkedEvidenceCanaryPolicy.id ||
    value.policy.version !== 1 ||
    !selectionPolicyValid ||
    !SHA256_PATTERN.test(value.sourceSnapshotId) ||
    ![value.adapterReceiptId, value.contextDeliveryId].every(
      (item) => item === null || SOURCE_ID_PATTERN.test(item),
    ) ||
    countKeys.some((key) => !boundedInteger(value[key], 8)) ||
    value.selectedCount > value.candidateCount ||
    value.loadedCount > value.selectedCount ||
    value.injectedCount > value.loadedCount ||
    value.referencedCount > value.injectedCount ||
    ![
      value.candidateDigest,
      value.selectedDigest,
      value.loadedDigest,
      value.injectedDigest,
      value.referencedDigest,
    ].every((item) => SHA256_PATTERN.test(item)) ||
    ![
      candidateBytes,
      selectionProviderVisibleBytes,
      value.selectedBytes,
      value.loadedBytes,
      value.injectedBytes,
    ].every((item) =>
      boundedInteger(item, managedLinkedEvidenceCanaryPolicy.maximumProviderVisibleSourceBytes),
    ) ||
    selectionProviderVisibleBytes > candidateBytes ||
    value.selectedBytes > candidateBytes ||
    value.loadedBytes > value.selectedBytes ||
    value.injectedBytes > value.loadedBytes ||
    !boundedInteger(value.durationMs, 24 * 60 * 60 * 1000) ||
    !validUsage(value.usage) ||
    !["completed", "failed"].includes(value.status) ||
    (value.failureCode !== null && !failureCodes.has(value.failureCode)) ||
    (value.status === "completed"
      ? value.failureCode !== null ||
        !completedSelectionTelemetryValid ||
        value.loadedCount !== value.selectedCount ||
        value.injectedCount !== value.loadedCount ||
        value.loadedBytes !== value.selectedBytes ||
        value.injectedBytes !== value.loadedBytes ||
        value.contextDeliveryId === null
      : value.failureCode === null) ||
    !canonicalTimestamp(value.recordedAt)
  ) {
    throw new SearchLocalError(
      "observation_invalid",
      "The managed linked-evidence canary record is invalid.",
    );
  }
  const { recordId: _recordId, ...core } = value;
  if (value.recordId !== `lcanary_${digest(core).slice("sha256:".length, 31)}`) {
    throw new SearchLocalError(
      "observation_invalid",
      "The managed linked-evidence canary record ID differs from its content.",
    );
  }
}

export function createManagedLinkedEvidenceCanaryRecord(
  input: RecordInput,
): ManagedLinkedEvidenceCanaryRecordV2 {
  const core = {
    schemaVersion: 2 as const,
    ...structuredClone(input),
    policy: { id: managedLinkedEvidenceCanaryPolicy.id, version: 1 as const },
  };
  const record: ManagedLinkedEvidenceCanaryRecordV2 = {
    recordId: `lcanary_${digest(core).slice("sha256:".length, 31)}`,
    ...core,
  };
  assertManagedLinkedEvidenceCanaryRecord(record);
  return record;
}

export class LocalManagedLinkedEvidenceCanaryStore {
  private constructor(private readonly directory: string) {}

  static async open(repositoryRoot: string): Promise<LocalManagedLinkedEvidenceCanaryStore> {
    return new LocalManagedLinkedEvidenceCanaryStore(
      await prepareObservationSubdirectory(repositoryRoot, "linked-evidence-managed-canary"),
    );
  }

  async list(): Promise<ManagedLinkedEvidenceCanaryRecord[]> {
    return listObservations({
      path: this.directory,
      pattern: RECORD_FILE,
      assertValue: assertManagedLinkedEvidenceCanaryRecord,
      expectedFileName: (value) => `${value.recordId}.json`,
    });
  }

  async record(record: ManagedLinkedEvidenceCanaryRecord): Promise<void> {
    assertManagedLinkedEvidenceCanaryRecord(record);
    const lockPath = resolve(this.directory, "..", ".linked-evidence-managed-canary.lock");
    let lock;
    try {
      lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      const records = await this.list();
      const existing = records.find((item) => item.runId === record.runId);
      if (existing !== undefined) {
        if (existing.recordId === record.recordId) return;
        throw new SearchLocalError(
          "observation_conflict",
          "A managed linked-evidence canary record already exists for this run.",
        );
      }
      if (records.length >= LINKED_EVIDENCE_MANAGED_CANARY_MAX_RECORDS) {
        throw new SearchLocalError(
          "observation_limit_exceeded",
          "The managed linked-evidence canary record limit was reached.",
        );
      }
      const target = resolve(this.directory, `${record.recordId}.json`);
      await writeObservation(target, record);
      const stored = await readObservation<ManagedLinkedEvidenceCanaryRecord>(target);
      assertManagedLinkedEvidenceCanaryRecord(stored);
      if (canonicalJson(stored) !== canonicalJson(record)) {
        throw new SearchLocalError(
          "observation_write_failed",
          "The managed linked-evidence canary record failed exact read-back validation.",
        );
      }
      if (process.platform !== "win32" && ((await stat(target)).mode & 0o777) !== 0o600) {
        throw new SearchLocalError(
          "observation_write_failed",
          "The managed linked-evidence canary record is not owner-only.",
        );
      }
    } catch (error) {
      if (error instanceof SearchLocalError) throw error;
      throw new SearchLocalError(
        "observation_write_failed",
        "Could not record the managed linked-evidence canary result.",
        { cause: error instanceof Error ? error : undefined },
      );
    } finally {
      await lock?.close();
      if (lock !== undefined) {
        try {
          await unlink(lockPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            // An unreleased lock makes later immutable writes indeterminate.
            // eslint-disable-next-line no-unsafe-finally
            throw new SearchLocalError(
              "observation_write_failed",
              "Could not release the managed linked-evidence canary lock.",
              { cause: error instanceof Error ? error : undefined },
            );
          }
        }
      }
    }
  }
}
