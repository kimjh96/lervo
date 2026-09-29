import {
  acquireRepositorySourceWrite,
  RepositorySourceGateError,
  type RepositorySourceLease,
} from "@lervo/project-storage";

import { RepositoryKnowledgeError } from "./types.js";

/** A live managed run wins admission; durable knowledge effects retry after it settles. */
export async function withKnowledgeSourceWrite<T>(
  repositoryRoot: string,
  operation: () => Promise<T>,
): Promise<T> {
  let lease: RepositorySourceLease;
  try {
    lease = await acquireRepositorySourceWrite(repositoryRoot);
  } catch (error) {
    if (error instanceof RepositorySourceGateError && error.code === "repository_source_busy")
      throw new RepositoryKnowledgeError(
        "knowledge_materialization_busy",
        "A managed repository operation is active; knowledge materialization must retry.",
      );
    throw new RepositoryKnowledgeError(
      "knowledge_source_gate_invalid",
      "The repository source gate could not be acquired safely.",
    );
  }
  try {
    return await operation();
  } finally {
    lease.release();
  }
}
