import { createHash } from "node:crypto";

import type { ProviderAdapter } from "@lervo/adapter-contract";
import {
  ManagedLinkedEvidenceCanaryError,
  managedLinkedEvidenceDeterministicSelectionPolicy,
  managedLinkedEvidenceCanaryPolicy,
  type ManagedLinkedEvidenceCanaryCandidate,
  type ManagedLinkedEvidenceSelection,
} from "@lervo/context";
import type { ManagedLinkedEvidenceUsageTotals } from "@lervo/search-local";
import type { AdapterSession } from "@lervo/schemas";

export type ManagedLinkedEvidenceProvider = "codex" | "claude";

interface ManagedLinkedEvidenceCanaryAuthorizationBase {
  schemaVersion: 1;
  enabled: true;
  policyId: typeof managedLinkedEvidenceCanaryPolicy.id;
  canaryId: string;
  projectId: string;
  runId: string;
  provider: ManagedLinkedEvidenceProvider;
  sourceSnapshotId: string;
  recommendationBatchId: string;
  selectionAttemptId: string;
  managedContextEffectsAuthorized: true;
}

export interface ManagedLinkedEvidenceProviderSelectionAuthorization extends ManagedLinkedEvidenceCanaryAuthorizationBase {
  maximumProviderCalls: 1;
}

export interface ManagedLinkedEvidenceDeterministicSelectionAuthorization extends ManagedLinkedEvidenceCanaryAuthorizationBase {
  maximumProviderCalls: 0;
  deterministicSelection: {
    kind: typeof managedLinkedEvidenceDeterministicSelectionPolicy.kind;
    policyId: typeof managedLinkedEvidenceDeterministicSelectionPolicy.policyId;
    policyDigest: typeof managedLinkedEvidenceDeterministicSelectionPolicy.digest;
    sourceProjectionDigest: string;
    projectedSelectionDigest: string;
    projectedSelectionCount: number;
  };
}

export type ManagedLinkedEvidenceCanaryAuthorization =
  | ManagedLinkedEvidenceProviderSelectionAuthorization
  | ManagedLinkedEvidenceDeterministicSelectionAuthorization;

export type ManagedLinkedEvidenceSelectionPolicy =
  | {
      kind: "provider_turn";
      policyId: typeof managedLinkedEvidenceCanaryPolicy.selectionProtocolId;
      policyDigest: string;
    }
  | {
      kind: "deterministic_policy";
      policyId: typeof managedLinkedEvidenceDeterministicSelectionPolicy.policyId;
      policyDigest: typeof managedLinkedEvidenceDeterministicSelectionPolicy.digest;
    };

export interface ManagedLinkedEvidenceCanaryOutcome {
  authorization: ManagedLinkedEvidenceCanaryAuthorization;
  selections: ManagedLinkedEvidenceSelection[];
  candidates: ManagedLinkedEvidenceCanaryCandidate[];
  sourceSnapshotId: string;
  candidateDigest: string;
  selectedDigest: string;
  providerVisibleBytes: number;
  selectedBytes: number;
  selectionProviderVisibleBytes: number;
  selectionPolicy: ManagedLinkedEvidenceSelectionPolicy;
  adapterReceiptId: string | null;
  durationMs: number;
  usage: ManagedLinkedEvidenceUsageTotals | null;
}

export interface ManagedLinkedEvidenceAdapterFactoryInput {
  provider: ManagedLinkedEvidenceProvider;
  repositoryRoot: string;
  resolveArtifact: (uri: string) => Promise<Uint8Array>;
  structuredOutputSchema?: Record<string, unknown>;
  selectionBoundary: "read_only_no_tools";
}

export type ManagedLinkedEvidenceAdapterFactory = (
  input: ManagedLinkedEvidenceAdapterFactoryInput,
) => ProviderAdapter;

export function assertManagedLinkedEvidenceSelectionBoundary(session: AdapterSession): void {
  if (
    session.executionMode !== "read_only" ||
    session.effectiveCapabilities.toolCalls !== "unsupported" ||
    session.effectiveCapabilities.commandExecution !== "unsupported" ||
    session.effectiveCapabilities.fileChanges !== "unsupported"
  ) {
    throw new ManagedLinkedEvidenceCanaryError(
      "canary_selection_unavailable",
      "The managed canary selection adapter cannot prove a read-only session without tools or commands.",
    );
  }
}

export function managedLinkedEvidenceDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function managedLinkedEvidenceCanonicalDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalValue(value)).digest("hex")}`;
}
