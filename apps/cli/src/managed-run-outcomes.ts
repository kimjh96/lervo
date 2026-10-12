import type { ManagedProviderRunResult } from "@lervo/execution-contract";
import { captureRepositorySnapshot } from "@lervo/orchestrator";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  hostOutcomeTask,
  observeHostContextOutcomes,
  type HostOutcomePolicy,
} from "@lervo/repository-context";

export async function observeManagedRunOutcomes(input: {
  storage: ProjectStorage;
  executionRepositoryRoot: string;
  run: ManagedProviderRunResult;
  instructions: string;
  baselines: ReadonlyMap<string, Uint8Array>;
  policy?: HostOutcomePolicy;
}) {
  const { run, storage } = input;
  const report = await observeHostContextOutcomes({
    repositoryRoot: input.executionRepositoryRoot,
    origin: "managed_run",
    effects: "owner_controlled",
    coordinates: { runId: run.session.runId, sessionId: run.session.sessionId },
    task: hostOutcomeTask(
      input.instructions,
      run.managedChanges.map((change) => change.path),
    ),
    artifacts: [
      ...run.managedChanges.map((change) => ({
        kind: "repository" as const,
        path: change.path,
        ...(change.afterHash ? { expectedDigest: change.afterHash } : {}),
        ...(input.baselines.has(change.path)
          ? { baselineBytes: input.baselines.get(change.path)! }
          : {}),
      })),
      {
        kind: "immutable",
        ...run.resultArtifact,
        readBytes: () => storage.artifacts.get(run.resultArtifact.uri),
      },
    ],
    ...(input.policy ? { policy: input.policy } : {}),
  });
  if (!report.completionAllowed)
    throw new Error("Required context outcome verification did not pass.");
  if (
    report.outcomes.some(
      (outcome) =>
        outcome.correction?.applied !== undefined && outcome.correction.applied !== false,
    )
  ) {
    const current = await captureRepositorySnapshot(input.executionRepositoryRoot);
    if (
      current.revision !== run.afterRevision ||
      run.verificationStatus !== "passed" ||
      run.verifications.some(
        ({ result }) =>
          result.repositoryRevision !== current.revision || result.status !== "passed",
      )
    )
      throw new Error(
        "Corrected execution has no current project-verification completion evidence.",
      );
  }
  return report;
}
