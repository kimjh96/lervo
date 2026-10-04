import { createHash } from "node:crypto";

import type { ArtifactStore } from "@lervo/storage-contract";

import {
  observeRepositoryWork,
  RepositoryWorkObservationLimitError,
} from "./repository-work-observation.js";

/** Stage failures, deadlines, and durable result reads shared by one repository-work turn. */
const MAXIMUM_FINALIZATION_RESERVE_MS = 5 * 60_000;
const MINIMUM_FINALIZATION_RESERVE_MS = 2_000;

export function finalizationStartsAt(timeoutMs: number, now = Date.now()): string {
  const reserve = Math.min(
    MAXIMUM_FINALIZATION_RESERVE_MS,
    Math.max(MINIMUM_FINALIZATION_RESERVE_MS, Math.floor(timeoutMs / 5)),
  );
  return new Date(now + Math.max(0, timeoutMs - reserve)).toISOString();
}

export class ConversationRepositoryWorkStageError extends Error {
  constructor(
    readonly code:
      | "repository_observation_failed"
      | "repository_result_storage_failed"
      | "repository_work_in_progress"
      | "measurement_unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConversationRepositoryWorkStageError";
  }
}

export function failureCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/u.test(error.code)
    ? error.code
    : "repository_work_failed";
}

export async function observe(repositoryRoot: string) {
  try {
    return await observeRepositoryWork(repositoryRoot);
  } catch (error) {
    if (error instanceof RepositoryWorkObservationLimitError) throw error;
    throw new ConversationRepositoryWorkStageError(
      "repository_observation_failed",
      "The repository work state could not be observed.",
      { cause: error },
    );
  }
}

/** ADR-0459: a turn that cannot produce its receipt or usage record fails its completion gate. */
export async function measured<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new ConversationRepositoryWorkStageError(
      "measurement_unavailable",
      "The repository work turn could not record its context receipt or usage.",
      { cause: error },
    );
  }
}

export async function readStoredResult(
  artifacts: ArtifactStore,
  reference: { contentHash: string; byteCount: number },
): Promise<string> {
  const uri = `lervo-cas://sha256/${reference.contentHash.slice("sha256:".length)}`;
  const bytes = new Uint8Array(await artifacts.get(uri));
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== reference.byteCount || contentHash !== reference.contentHash) {
    throw new Error("The durable conversation work result differs from its artifact.");
  }
  return new TextDecoder("utf8", { fatal: true }).decode(bytes);
}
