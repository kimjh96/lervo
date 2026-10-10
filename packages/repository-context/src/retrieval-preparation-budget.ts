import { randomUUID } from "node:crypto";
import { contextPreparationHost } from "./context-preparation-host.js";

/** Retrieval cannot share a result until its current source generation is known. Bound admission
 * on the same host as exact loading; existing generation-bound indexes own computational reuse. */
export function withRetrievalPreparationBudget<T>(
  work: () => Promise<T>,
  input: {
    signal?: AbortSignal;
    deadlineMs?: number;
  } = {},
): Promise<T> {
  return contextPreparationHost.run({
    key: `retrieval_${randomUUID()}`,
    reservedBytes: 16 * 1024 * 1024,
    deadlineMs: input.deadlineMs ?? 30000,
    maximumProviderCalls: 0,
    signal: input.signal ?? new AbortController().signal,
    work,
  });
}
