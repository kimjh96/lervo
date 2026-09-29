import { state, retryConcurrent, acquireLock } from "./workforce-state-io.js";
import { resolve } from "node:path";

export function withAssignmentRoutineLock<T>(input: {
  repositoryRoot: string;
  operation: () => Promise<T>;
  now?: Date;
}): Promise<T> {
  return retryConcurrent(async () => {
    const current = await state(input.repositoryRoot);
    const release = await acquireLock(
      resolve(current.base, "graph-materialization.lock"),
      input.now ?? new Date(),
    );
    try {
      return await input.operation();
    } finally {
      await release();
    }
  });
}

export const withAssignmentTopologyLock = withAssignmentRoutineLock;
