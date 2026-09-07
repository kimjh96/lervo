import { readCurrentWorkstreamState } from "@lervo/repository-knowledge/workstream";
import type { RemoteContinuationCoordinate } from "@lervo/schemas";

import { ManagedProviderHostError } from "./types.js";

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
