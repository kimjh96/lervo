import { inspectEventWriterCoordinate } from "@lervo/project";
import {
  knowledgeResidentHoldReason,
  startKnowledgeResidentHold,
} from "@lervo/repository-knowledge-runtime";

/** How often a held Node resident rereads the writer coordinate. */
export const KNOWLEDGE_WORKER_ADMISSION_POLL_MILLISECONDS = 60_000;

async function writerSchemaVersion(repositoryRoot: string): Promise<number> {
  return (await inspectEventWriterCoordinate(repositoryRoot)).coordinate.selectedEventSchemaVersion;
}

/**
 * ADR-0470: a Node resident child for a checkout whose event writer is older than the resident
 * schema heartbeats `attention` (`event_schema_outdated`) instead of exiting, and resumes as soon
 * as `lervo upgrade` (or any reviewed activation) selects the resident schema. It never activates
 * the writer itself: a Node-served checkout needs the Hub-enabled activation, which re-observes
 * this Node and the Hub. Resolves true when admitted and false when stopped first.
 */
export async function awaitKnowledgeWorkerAdmission(input: {
  repositoryRoot: string;
  workerId: string;
  initialSchemaVersion: number | undefined;
  signal: AbortSignal;
  onFailure: (error: unknown) => void;
  readSchemaVersion?: (repositoryRoot: string) => Promise<number>;
  pollMilliseconds?: number;
  startHold?: typeof startKnowledgeResidentHold;
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
  try {
    while (!input.signal.aborted) {
      await new Promise<void>((resolveWait) => {
        const timer = setTimeout(
          done,
          input.pollMilliseconds ?? KNOWLEDGE_WORKER_ADMISSION_POLL_MILLISECONDS,
        );
        function done() {
          clearTimeout(timer);
          input.signal.removeEventListener("abort", done);
          resolveWait();
        }
        input.signal.addEventListener("abort", done, { once: true });
      });
      if (input.signal.aborted) return false;
      const version = await read(input.repositoryRoot).catch((error: unknown) => {
        input.onFailure(error);
        return undefined;
      });
      if (version !== undefined && knowledgeResidentHoldReason(version) === null) return true;
    }
    return false;
  } finally {
    await stopHold();
  }
}
