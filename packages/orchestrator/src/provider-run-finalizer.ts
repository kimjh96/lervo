import type { ProviderAdapter } from "@lervo/adapter-contract";
import type { AdapterSession, AdapterStopRequest } from "@lervo/schemas";

import { adapterStoppedSpec, unmanagedChangeSpec } from "./provider-run-events.js";
import { withinDeadline, type ManagedProviderRunDeadlines } from "./provider-run-deadline.js";
import { RunFailureLedger } from "./provider-run-failures.js";
import { assertManagedStopResult } from "./provider-run-validation.js";
import type { ProviderSignalMonitor } from "./provider-signal-monitor.js";
import {
  inspectManagedRepositoryChanges,
  type CaptureRepositorySnapshot,
  type RepositorySnapshot,
  type RepositorySnapshotPolicy,
} from "./repository-snapshot.js";
import type { ManagedEventSpec } from "./telemetry.js";
import { ManagedProviderRunError } from "./provider-run-types.js";
import { observeManagedProviderProcess } from "./provider-process-observation.js";
import type { ManagedFileChangeEvidence } from "./types.js";

export interface FinalizeProviderRunInput {
  adapter: ProviderAdapter;
  session?: AdapterSession;
  monitor?: ProviderSignalMonitor;
  before?: RepositorySnapshot;
  repositoryRoot: string;
  captureSnapshot: CaptureRepositorySnapshot;
  snapshotPolicy?: RepositorySnapshotPolicy;
  deadlines: ManagedProviderRunDeadlines;
  failures: RunFailureLedger;
  managedChanges: readonly ManagedFileChangeEvidence[];
  time: () => string;
  append: (specs: ManagedEventSpec[]) => void;
  measureStage<T>(
    stageId: "provider_stop" | "repository_snapshot",
    operation: () => Promise<T>,
  ): Promise<T>;
}

async function drainProviderStream(input: FinalizeProviderRunInput): Promise<void> {
  if (input.monitor === undefined) return;
  try {
    input.monitor.abort();
    await withinDeadline({
      operation: () => input.monitor!.done,
      timeoutMs: input.deadlines.streamDrainMs,
      failureCode: "provider_stream_failed",
      label: "provider signal stream shutdown",
    });
    input.monitor.throwIfFailed();
  } catch (error) {
    input.failures.add(error, "provider_stream");
  }
}

async function stopAdapter(input: FinalizeProviderRunInput): Promise<void> {
  if (input.session === undefined) return;
  try {
    input.append([
      observeManagedProviderProcess({
        adapter: input.adapter,
        session: input.session,
        phase: "before_stop",
      }),
    ]);
  } catch (error) {
    input.failures.add(error, "adapter_stop");
  }
  try {
    const stopRequest: AdapterStopRequest = {
      kind: "stop_request",
      schemaVersion: 1,
      adapterId: input.adapter.descriptor.adapterId,
      projectId: input.session.projectId,
      runId: input.session.runId,
      sessionId: input.session.sessionId,
      providerSessionId: input.session.providerSessionId,
      reason:
        input.failures.primary?.error.code === "cancelled"
          ? "cancelled"
          : input.failures.empty
            ? "completed"
            : "failed",
      requestedAt: input.time(),
    };
    const stopped = await withinDeadline({
      operation: () => input.adapter.stop(input.session!, stopRequest),
      timeoutMs: input.deadlines.adapterStopMs,
      failureCode: "provider_stop_failed",
      label: "provider session shutdown",
    });
    assertManagedStopResult({ request: stopRequest, result: stopped });
    input.append([adapterStoppedSpec(input.session, stopped)]);
  } catch (error) {
    input.failures.add(error, "adapter_stop");
  }
}

async function captureAfterSnapshot(
  input: FinalizeProviderRunInput,
): Promise<RepositorySnapshot | undefined> {
  if (input.before === undefined) return undefined;
  try {
    const after = await withinDeadline({
      operation: () => input.captureSnapshot(input.repositoryRoot, input.snapshotPolicy),
      timeoutMs: input.deadlines.snapshotMs,
      failureCode: "repository_snapshot_failed",
      label: "post-run repository snapshot",
    });
    const inspection = inspectManagedRepositoryChanges({
      before: input.before,
      after,
      managedChanges: input.managedChanges,
    });
    if (inspection.invalidManagedPaths.length > 0) {
      input.failures.add(
        new ManagedProviderRunError(
          "provider_write_failed",
          "The verified provider changes differ from the pre-run and post-run snapshots.",
          { paths: inspection.invalidManagedPaths },
        ),
        "after_snapshot",
      );
    }
    const paths = inspection.unmanagedPaths;
    if (paths.length > 0) {
      input.append([
        unmanagedChangeSpec({
          paths,
          beforeRevision: input.before.revision,
          afterRevision: after.revision,
          detectedAt: input.time(),
        }),
      ]);
      input.failures.add(
        new ManagedProviderRunError(
          "unmanaged_change_detected",
          "An unmanaged repository change was detected during provider execution.",
          { paths },
        ),
        "after_snapshot",
      );
    }
    return after;
  } catch (error) {
    input.failures.add(error, "after_snapshot");
    return undefined;
  }
}

export async function finalizeProviderRun(
  input: FinalizeProviderRunInput,
): Promise<RepositorySnapshot | undefined> {
  await input.measureStage("provider_stop", async () => {
    await drainProviderStream(input);
    await stopAdapter(input);
  });
  return input.measureStage("repository_snapshot", () => captureAfterSnapshot(input));
}
