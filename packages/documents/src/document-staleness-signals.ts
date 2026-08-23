import type {
  DocumentManifest,
  DocumentStalenessReason,
  DocumentStalenessResult,
} from "@lervo/schemas";

import type {
  DocumentStalenessRepositorySnapshot,
  ManagedInputObservation,
} from "./document-staleness-types.js";
import {
  compareText,
  invalidStalenessRequest,
  isContentHash,
} from "./document-staleness-validation.js";

const MAXIMUM_INPUTS = 4096;

export type StalenessSignalStatus = "current" | "stale" | "unknown";

export interface RevisionStalenessSignals {
  documentPath: { status: StalenessSignalStatus };
  connectedPaths: {
    status: StalenessSignalStatus;
    changedPaths: string[];
    unobservedPaths: string[];
  };
  reasons: DocumentStalenessReason[];
}

interface ExpectedInput {
  sourceId: string;
  contentHash: string;
}

function filesInScope(
  snapshot: DocumentStalenessRepositorySnapshot,
  scope: string,
): ReadonlyMap<string, string> {
  const entries = Object.entries(snapshot.files)
    .filter(([path]) => path === scope || path.startsWith(`${scope}/`))
    .sort(([left], [right]) => compareText(left, right));
  return new Map(entries);
}

function changedScopePaths(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths]
    .filter((path) => before.get(path) !== after.get(path))
    .sort(compareText);
}

function unavailableRevisionSignals(
  reason: "verified_snapshot_mismatch" | "verified_snapshot_unavailable",
): RevisionStalenessSignals {
  return {
    documentPath: { status: "unknown" },
    connectedPaths: { status: "unknown", changedPaths: [], unobservedPaths: [] },
    reasons: [reason],
  };
}

export function evaluateRevisionStaleness(
  manifest: DocumentManifest,
  current: DocumentStalenessRepositorySnapshot,
  verified: DocumentStalenessRepositorySnapshot | undefined,
): RevisionStalenessSignals {
  if (current.revision === manifest.record.verifiedRevision) {
    const documentMissing = current.files[manifest.record.path] === undefined;
    const unobservedPaths = manifest.record.connectedPaths
      .filter((scope) => filesInScope(current, scope).size === 0)
      .sort(compareText);
    return {
      documentPath: { status: documentMissing ? "stale" : "current" },
      connectedPaths: {
        status: unobservedPaths.length > 0 ? "unknown" : "current",
        changedPaths: [],
        unobservedPaths,
      },
      reasons: [
        ...(documentMissing ? ["document_path_missing" as const] : []),
        ...(unobservedPaths.length > 0 ? ["connected_path_unobserved" as const] : []),
      ],
    };
  }
  if (verified === undefined) return unavailableRevisionSignals("verified_snapshot_unavailable");
  if (verified.revision !== manifest.record.verifiedRevision) {
    return unavailableRevisionSignals("verified_snapshot_mismatch");
  }

  const reasons: DocumentStalenessReason[] = [];
  const beforeDocument = verified.files[manifest.record.path];
  const currentDocument = current.files[manifest.record.path];
  let documentStatus: StalenessSignalStatus;
  if (beforeDocument === undefined && currentDocument === undefined) {
    documentStatus = "unknown";
    reasons.push("document_path_unobserved");
  } else if (beforeDocument === currentDocument) {
    documentStatus = "current";
  } else {
    documentStatus = "stale";
    reasons.push("document_path_changed");
  }

  const changedPaths = new Set<string>();
  const unobservedPaths: string[] = [];
  for (const scope of manifest.record.connectedPaths) {
    const before = filesInScope(verified, scope);
    const after = filesInScope(current, scope);
    const changed = changedScopePaths(before, after);
    if (changed.length > 0) {
      for (const path of changed) changedPaths.add(path);
    } else if (before.size === 0 && after.size === 0) {
      unobservedPaths.push(scope);
    }
  }
  let connectedStatus: StalenessSignalStatus = "current";
  if (changedPaths.size > 0) {
    connectedStatus = "stale";
    reasons.push("connected_path_changed");
  } else if (unobservedPaths.length > 0) {
    connectedStatus = "unknown";
    reasons.push("connected_path_unobserved");
  }
  return {
    documentPath: { status: documentStatus },
    connectedPaths: {
      status: connectedStatus,
      changedPaths: [...changedPaths].sort(compareText),
      unobservedPaths: unobservedPaths.sort(compareText),
    },
    reasons,
  };
}

function expectedInputs(manifest: DocumentManifest): ExpectedInput[] {
  const ownership = manifest.record.ownership;
  if (ownership.mode === "user") return [];
  const inputs = ownership.mode === "managed_blocks"
    ? ownership.blocks.flatMap((block) => block.inputs)
    : ownership.inputs;
  const expected = new Map<string, string>();
  for (const input of inputs) {
    if (expected.has(input.sourceId)) {
      invalidStalenessRequest("The same managed input source ID was declared more than once.");
    }
    expected.set(input.sourceId, input.contentHash);
  }
  return [...expected]
    .map(([sourceId, contentHash]) => ({ sourceId, contentHash }))
    .sort((left, right) => compareText(left.sourceId, right.sourceId));
}

function validateObservations(
  observations: readonly ManagedInputObservation[],
  expected: readonly ExpectedInput[],
): ReadonlyMap<string, ManagedInputObservation> {
  if (observations.length > MAXIMUM_INPUTS) {
    invalidStalenessRequest("The managed input observation count exceeds the limit.");
  }
  const expectedIds = new Set(expected.map((input) => input.sourceId));
  const result = new Map<string, ManagedInputObservation>();
  for (const observation of observations) {
    if (
      observation.sourceId.length < 1 || observation.sourceId.length > 200 ||
      result.has(observation.sourceId) || !expectedIds.has(observation.sourceId) ||
      (observation.status === "available" && !isContentHash(observation.contentHash))
    ) {
      invalidStalenessRequest("The managed input observation does not satisfy the manifest and common contract.");
    }
    result.set(observation.sourceId, observation);
  }
  return result;
}

export function evaluateManagedInputStaleness(
  manifest: DocumentManifest,
  observations: readonly ManagedInputObservation[],
): {
  signal: DocumentStalenessResult["signals"]["managedInputs"];
  reasons: DocumentStalenessReason[];
} {
  const expected = expectedInputs(manifest);
  const observed = validateObservations(observations, expected);
  if (expected.length === 0) {
    return {
      signal: {
        status: "not_applicable",
        changedSourceIds: [],
        missingSourceIds: [],
        unobservedSourceIds: [],
      },
      reasons: [],
    };
  }
  const changedSourceIds: string[] = [];
  const missingSourceIds: string[] = [];
  const unobservedSourceIds: string[] = [];
  for (const input of expected) {
    const observation = observed.get(input.sourceId);
    if (observation === undefined) unobservedSourceIds.push(input.sourceId);
    else if (observation.status === "missing") missingSourceIds.push(input.sourceId);
    else if (observation.contentHash !== input.contentHash) changedSourceIds.push(input.sourceId);
  }
  const reasons: DocumentStalenessReason[] = [];
  if (changedSourceIds.length > 0) reasons.push("managed_input_changed");
  if (missingSourceIds.length > 0) reasons.push("managed_input_missing");
  if (unobservedSourceIds.length > 0) reasons.push("managed_input_unobserved");
  return {
    signal: {
      status: changedSourceIds.length > 0 || missingSourceIds.length > 0
        ? "stale"
        : unobservedSourceIds.length > 0 ? "unknown" : "current",
      changedSourceIds,
      missingSourceIds,
      unobservedSourceIds,
    },
    reasons,
  };
}
