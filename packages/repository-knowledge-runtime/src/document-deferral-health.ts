import { resolve } from "node:path";
import { sha256, type RepositoryLayoutMigrationPlan } from "@lervo/repository-knowledge";

import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";

const STATE_PATH = ".lervo/state/knowledge/document-deferrals.json";
const MAXIMUM_DEFERRALS = 4096;
interface DeferralObservation {
  pathHash: string;
  firstObservedAt: string;
}
interface DeferralState {
  schemaVersion: 1;
  observedAt: string;
  count: number;
  oldestDeferredAt: string | null;
  documents: DeferralObservation[];
  historyTruncated?: boolean;
}

/** Replaced by each current scan. Only path hashes and timestamps persist; resolved paths are pruned. */
export async function observeDocumentDeferrals(input: {
  repositoryRoot: string;
  layout: RepositoryLayoutMigrationPlan;
  now?: Date;
}): Promise<void> {
  const path = resolve(input.repositoryRoot, STATE_PATH);
  const previous = await readState(input.repositoryRoot);
  const prior = new Map(
    previous?.documents.map((document) => [document.pathHash, document.firstObservedAt]),
  );
  const observedAt = (input.now ?? new Date()).toISOString();
  const documents = input.layout.deferredDocuments.map((document) => {
    const pathHash = sha256(document.path);
    return { pathHash, firstObservedAt: prior.get(pathHash) ?? observedAt };
  });
  // Retain the oldest observations first if the scan exceeds the host-private bound.
  documents.sort(
    (a, b) =>
      a.firstObservedAt.localeCompare(b.firstObservedAt) || a.pathHash.localeCompare(b.pathHash),
  );
  const historyTruncated =
    documents.length > MAXIMUM_DEFERRALS ||
    (documents.length > 0 &&
      (previous?.historyTruncated === true ||
        (previous !== null && previous.count > previous.documents.length)));
  const state: DeferralState = {
    schemaVersion: 1,
    observedAt,
    count: input.layout.deferredDocumentCount,
    oldestDeferredAt: historyTruncated ? null : (documents[0]?.firstObservedAt ?? null),
    historyTruncated,
    documents: documents.slice(0, MAXIMUM_DEFERRALS),
  };
  await writePrivateJsonFile(path, state);
}

async function readState(root: string): Promise<DeferralState | null> {
  const file = await readPrivateJsonFile(resolve(root, STATE_PATH), 1024 * 1024);
  if (file.status !== "read") return null;
  const value = file.value as Partial<DeferralState> | null;
  return value?.schemaVersion === 1 &&
    typeof value.observedAt === "string" &&
    Number.isFinite(Date.parse(value.observedAt)) &&
    Number.isSafeInteger(value.count) &&
    value.count! >= 0 &&
    (value.historyTruncated === undefined || typeof value.historyTruncated === "boolean") &&
    Array.isArray(value.documents) &&
    value.documents.length <= MAXIMUM_DEFERRALS &&
    value.documents.every(
      (document) =>
        document !== null &&
        typeof document === "object" &&
        typeof document.pathHash === "string" &&
        typeof document.firstObservedAt === "string" &&
        /^sha256:[a-f0-9]{64}$/u.test(document.pathHash) &&
        Number.isFinite(Date.parse(document.firstObservedAt)),
    ) &&
    (value.oldestDeferredAt === null ||
      (typeof value.oldestDeferredAt === "string" &&
        Number.isFinite(Date.parse(value.oldestDeferredAt))))
    ? (value as DeferralState)
    : null;
}

/** ADR-0535 integration surface. A missing observation is unknown, never a zero-debt claim. */
export async function inspectDocumentDeferralHealth(input: {
  repositoryRoot: string;
  now?: Date;
}): Promise<{
  observedAt: string;
  deferredDocumentCount: number;
  oldestDeferralAgeMs: number | null;
  historyTruncated: boolean;
} | null> {
  const state = await readState(input.repositoryRoot);
  return state === null
    ? null
    : {
        observedAt: state.observedAt,
        deferredDocumentCount: state.count,
        historyTruncated: state.historyTruncated === true || state.count > state.documents.length,
        oldestDeferralAgeMs:
          state.historyTruncated === true ||
          state.count > state.documents.length ||
          state.oldestDeferredAt === null
            ? null
            : Math.max(0, (input.now ?? new Date()).getTime() - Date.parse(state.oldestDeferredAt)),
      };
}
