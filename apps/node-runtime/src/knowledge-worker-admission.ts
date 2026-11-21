import { inspectEventWriterCoordinate, resolveProjectPaths } from "@lervo/project";
import {
  knowledgeResidentHoldReason,
  repositoryWatchReporter,
  startKnowledgeResidentHold,
  watchFiles,
} from "@lervo/repository-knowledge-runtime";

async function writerSchemaVersion(repositoryRoot: string): Promise<number> {
  return (await inspectEventWriterCoordinate(repositoryRoot)).coordinate.selectedEventSchemaVersion;
}

/** A failed writer-coordinate read retries after this, doubling to the ceiling. */
export const COORDINATE_READ_RETRY_MILLISECONDS = 5_000;
export const COORDINATE_READ_RETRY_CEILING_MILLISECONDS = 15 * 60_000;

/**
 * ADR-0470: a Node resident child for a checkout whose event writer is older than the resident
 * schema heartbeats `attention` (`event_schema_outdated`) instead of exiting, and resumes as soon
 * as `lervo upgrade` (or any reviewed activation) selects the resident schema. It never activates
 * the writer itself: a Node-served checkout needs the Hub-enabled activation, which re-observes
 * this Node and the Hub. Resolves true when admitted and false when stopped first.
 *
 * ADR-0602: it waits on a watch of the writer coordinate file, which every activation rewrites,
 * and reads the coordinate once right after arming it, so it never polls. A watch that cannot be
 * armed is visible as `repository_watch_unavailable`.
 */
export async function awaitKnowledgeWorkerAdmission(input: {
  repositoryRoot: string;
  workerId: string;
  initialSchemaVersion: number | undefined;
  signal: AbortSignal;
  onFailure: (error: unknown) => void;
  readSchemaVersion?: (repositoryRoot: string) => Promise<number>;
  startHold?: typeof startKnowledgeResidentHold;
  /** Test seam: the coordinate file whose change triggers a read. */
  coordinatePath?: string;
}): Promise<boolean> {
  const reason = knowledgeResidentHoldReason(input.initialSchemaVersion);
  if (reason === null) return true;
  const read = input.readSchemaVersion ?? writerSchemaVersion;
  const stopHold = (input.startHold ?? startKnowledgeResidentHold)({
    repositoryRoot: input.repositoryRoot,
    workerId: input.workerId,
    reason,
    onFailure: input.onFailure,
  });
  const report = repositoryWatchReporter(input.repositoryRoot);
  let changed: () => void = () => undefined;
  const watch = watchFiles(
    [input.coordinatePath ?? resolveProjectPaths(input.repositoryRoot).eventContract],
    () => changed(),
    (error) => void report.failed(error),
  );
  if (watch.unwatched.length > 0)
    await report.failed(
      Object.assign(new Error("The event writer coordinate cannot be watched."), {
        code: "ENOENT",
      }),
    );
  // One abort listener for the whole wait; it ends whichever wait is current.
  const aborted = () => changed();
  input.signal.addEventListener("abort", aborted, { once: true });
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  try {
    while (!input.signal.aborted) {
      // Armed first, so a change while reading is never lost.
      const next = new Promise<void>((resolveWait) => {
        changed = resolveWait;
      });
      const version = await read(input.repositoryRoot).catch((error: unknown) => {
        input.onFailure(error);
        return undefined;
      });
      if (version !== undefined && knowledgeResidentHoldReason(version) === null) return true;
      // ADR-0602: a failed read is retried once at a growing delay, since no change may follow;
      // a readable version that still holds waits for the coordinate's change alone.
      if (version === undefined) {
        failures = Math.min(failures + 1, 64);
        retry = setTimeout(
          () => changed(),
          Math.min(
            COORDINATE_READ_RETRY_CEILING_MILLISECONDS,
            COORDINATE_READ_RETRY_MILLISECONDS * 2 ** Math.min(failures - 1, 30),
          ),
        );
      } else failures = 0;
      if (input.signal.aborted) break;
      await next;
      if (retry !== null) clearTimeout(retry);
      retry = null;
    }
    return false;
  } finally {
    if (retry !== null) clearTimeout(retry);
    input.signal.removeEventListener("abort", aborted);
    watch.stop();
    await report.armed();
    await stopHold();
  }
}
