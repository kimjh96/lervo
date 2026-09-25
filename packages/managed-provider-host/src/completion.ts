import type { ManagedProviderRunResult } from "@lervo/execution-contract";
import {
  inspectRepositoryKnowledgeCurrency,
  readCurrentWorkstreamState,
} from "@lervo/repository-knowledge";
import type { RemoteContinuationCoordinate } from "@lervo/schemas";

import { ManagedProviderHostError } from "./types.js";

export async function assertManagedRepositoryKnowledgeCurrent(
  repositoryRoot: string,
): Promise<void> {
  if (!(await inspectRepositoryKnowledgeCurrency(repositoryRoot)).current) {
    throw new ManagedProviderHostError(
      "managed_completion_invalid",
      "The managed provider run left repository knowledge migration, normalization, or lint incomplete.",
    );
  }
}

export async function verifyManagedProviderHostCompletion(input: {
  repositoryRoot: string;
  continuation: RemoteContinuationCoordinate | undefined;
  run: ManagedProviderRunResult;
}): Promise<void> {
  if (input.run.managedChanges.length === 0 || input.continuation === undefined) return;
  const current = await readCurrentWorkstreamState(input.repositoryRoot);
  if (
    current === null ||
    current.snapshot.workstreamId !== input.continuation.workstreamId ||
    current.snapshot.revision <= input.continuation.revision ||
    current.contentHash === input.continuation.snapshotContentHash
  ) {
    throw new ManagedProviderHostError(
      "managed_completion_invalid",
      "The repository changed without advancing the exact continued workstream.",
    );
  }
  await assertManagedRepositoryKnowledgeCurrent(input.repositoryRoot);
}
