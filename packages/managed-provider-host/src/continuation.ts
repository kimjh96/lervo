import { readCurrentWorkstreamState } from "@lervo/repository-knowledge/workstream";
import { documentIdForPath, type ContextDocumentCandidate } from "@lervo/context";
import type { RoleProfile } from "@lervo/schemas";
import type { RemoteContinuationCoordinate } from "@lervo/schemas";

import { ManagedProviderHostError } from "./types.js";

const WORKSTREAM_PATH = ".lervo/state/workstreams/current.json";

export function managedProviderContinuationContext(role: RoleProfile): {
  role: RoleProfile;
  documentRules: { "repository.workstream": string[] };
  additionalCandidates: ContextDocumentCandidate[];
} {
  const documentId = documentIdForPath(WORKSTREAM_PATH);
  const preparedRole = structuredClone(role);
  if (!preparedRole.contextPolicy.requiredDocumentRuleIds.includes("repository.workstream")) {
    preparedRole.contextPolicy.requiredDocumentRuleIds.push("repository.workstream");
  }
  return {
    role: preparedRole,
    documentRules: { "repository.workstream": [documentId] },
    additionalCandidates: [
      {
        documentId,
        path: WORKSTREAM_PATH,
        connectedPaths: [],
        source: "workstream",
        documentRole: "governance_context",
        referenceEligible: false,
      },
    ],
  };
}

export async function verifyManagedProviderContinuation(input: {
  repositoryRoot: string;
  continuation: RemoteContinuationCoordinate;
}): Promise<void> {
  let current;
  try {
    current = await readCurrentWorkstreamState(input.repositoryRoot);
  } catch (error) {
    throw new ManagedProviderHostError(
      "managed_continuation_mismatch",
      "The managed provider host could not verify the current workstream.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
  if (
    current === null ||
    current.snapshot.status !== "active" ||
    current.snapshot.workstreamId !== input.continuation.workstreamId ||
    current.snapshot.revision !== input.continuation.revision ||
    current.contentHash !== input.continuation.snapshotContentHash
  ) {
    throw new ManagedProviderHostError(
      "managed_continuation_mismatch",
      "The signed continuation coordinate differs from the active local workstream.",
    );
  }
}
