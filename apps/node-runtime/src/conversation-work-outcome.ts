import {
  hostOutcomeTask,
  observeHostContextOutcomes,
  type HostOutcomePolicy,
} from "@lervo/repository-context";
import type { ArtifactStore } from "@lervo/storage-contract";
import { conversationRepositoryWorkCoordinates } from "./conversation-repository-work-measurement.js";

/** Native work has no admitted host write port. It can verify but cannot correct repository bytes. */
export async function verifyConversationWorkOutcome(input: {
  repositoryRoot: string;
  request: string;
  sourceEventId: string;
  changedPaths: readonly string[];
  result: { contentHash: string; byteCount: number };
  artifacts: ArtifactStore;
  policy?: HostOutcomePolicy;
}): Promise<void> {
  const { result } = input;
  const report = await observeHostContextOutcomes({
    repositoryRoot: input.repositoryRoot,
    origin: "conversation",
    effects: "read_only",
    coordinates: conversationRepositoryWorkCoordinates(input.sourceEventId),
    task: hostOutcomeTask(input.request, input.changedPaths),
    ...(input.policy ? { policy: input.policy } : {}),
    artifacts: [
      ...input.changedPaths.map((path) => ({ kind: "repository" as const, path })),
      {
        kind: "immutable",
        artifactId: "art_" + result.contentHash.slice(7),
        ...result,
        readBytes: () => input.artifacts.get("lervo-cas://sha256/" + result.contentHash.slice(7)),
      },
    ],
  });
  if (!report.completionAllowed)
    throw new Error("Required repository-work outcome verification did not pass.");
}
