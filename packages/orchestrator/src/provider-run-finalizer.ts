import type { ProviderAdapter } from "@roven/adapter-contract";
import type { AdapterSession, AdapterStopRequest } from "@roven/schemas";

import { adapterStoppedSpec, unmanagedChangeSpec } from "./provider-run-events.js";
import { withinDeadline, type ManagedProviderRunDeadlines } from "./provider-run-deadline.js";
import { RunFailureLedger } from "./provider-run-failures.js";
import { assertManagedStopResult } from "./provider-run-validation.js";
import type { ProviderSignalMonitor } from "./provider-signal-monitor.js";
import {
  changedRepositoryPaths,
  type CaptureRepositorySnapshot,
  type RepositorySnapshot,
  type RepositorySnapshotPolicy,
} from "./repository-snapshot.js";
import type { ManagedEventSpec } from "./telemetry.js";
import { ManagedProviderRunError } from "./provider-run-types.js";

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
  time: () => string;
  append: (specs: ManagedEventSpec[]) => void;
}

async function drainProviderStream(input: FinalizeProviderRunInput): Promise<void> {
  if (input.monitor === undefined) return;
  try {
    input.monitor.abort();
    await withinDeadline({
      operation: () => input.monitor!.done,
      timeoutMs: input.deadlines.streamDrainMs,
      failureCode: "provider_stream_failed",
      label: "Provider signal stream 종료",
    });
    input.monitor.throwIfFailed();
  } catch (error) {
    input.failures.add(error, "provider_stream");
  }
}

async function stopAdapter(input: FinalizeProviderRunInput): Promise<void> {
  if (input.session === undefined) return;
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
      label: "Provider session 종료",
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
      operation: () =>
        input.captureSnapshot(input.repositoryRoot, input.snapshotPolicy),
      timeoutMs: input.deadlines.snapshotMs,
      failureCode: "repository_snapshot_failed",
      label: "실행 후 repository snapshot",
    });
    const paths = changedRepositoryPaths(input.before, after);
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
          "Provider 실행 중 관리되지 않은 저장소 변경을 발견했습니다.",
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
  await drainProviderStream(input);
  await stopAdapter(input);
  return captureAfterSnapshot(input);
}
