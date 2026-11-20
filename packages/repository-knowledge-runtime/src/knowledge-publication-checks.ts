import { createHash } from "node:crypto";

import {
  KnowledgePublicationForgeError,
  type KnowledgePublicationCheckFailure,
  type KnowledgePublicationChecks,
  type KnowledgePublicationForge,
} from "./knowledge-publication-forge.js";
import type { KnowledgePublicationInventory } from "./knowledge-publication-git.js";
import {
  knowledgePublicationChecksBackoff,
  type KnowledgePublicationChecksRetry,
  type KnowledgePublicationState,
} from "./knowledge-publication-state.js";

/**
 * ADR-0596: how the publisher recovers from failed checks on a published head that did not
 * change. Everything here is pure except the one rerun request.
 */

/** Conclusions a rerun of the same bytes can change: the job never ran or did not finish. */
const TRANSIENT_CONCLUSIONS = new Set([
  "not_run",
  "cancelled",
  "timed_out",
  "startup_failure",
  "stale",
]);

const DETAIL_LIMIT = 480;

/** Digest of the local base and the unpublished commits; any new commit or base move changes it. */
export function knowledgePublicationInventoryKey(
  inventory: Pick<KnowledgePublicationInventory, "base" | "knowledge">,
): string {
  const hash = createHash("sha256");
  hash.update(inventory.base);
  for (const commit of inventory.knowledge) hash.update(`\n${commit.sha}`);
  return `sha256:${hash.digest("hex")}`;
}

/**
 * Whether the last failed-check observation still stands: the same head is published, the local
 * inventory did not change, and its backoff has not elapsed. The publisher then skips the fetch
 * and every forge call for this cycle.
 */
export function knowledgePublicationChecksWaiting(
  previous: KnowledgePublicationState | null,
  inventoryKey: string | null,
  now: Date,
): boolean {
  const retry = previous?.checksRetry;
  return (
    previous?.status === "failed" &&
    previous.failure?.code === "knowledge_publication_checks_failed" &&
    retry !== undefined &&
    retry.head === previous.publishedHead &&
    retry.inventoryKey === inventoryKey &&
    Date.parse(retry.retryAt) > now.getTime()
  );
}

/** The retry record that still applies to `head`; a new head starts without one. */
export function currentChecksRetry(
  previous: KnowledgePublicationState | null,
  head: string,
): KnowledgePublicationChecksRetry | undefined {
  return previous?.checksRetry?.head === head ? previous.checksRetry : undefined;
}

/** Bounded detail naming each failed check, such as `2 of 5 checks failed: lint (not_run)`. */
export function knowledgePublicationChecksDetail(
  checks: Extract<KnowledgePublicationChecks, { state: "failed" }>,
): string {
  const counted = `${checks.failed} of ${checks.total} checks failed`;
  if (checks.failures.length === 0) return counted;
  const named = checks.failures.map((failure) => `${failure.name} (${failure.conclusion})`);
  const more = checks.failed - checks.failures.length;
  const detail = `${counted}: ${named.join("; ")}${more > 0 ? `; ${more} more` : ""}`;
  return detail.length > DETAIL_LIMIT ? `${detail.slice(0, DETAIL_LIMIT - 1)}…` : detail;
}

/** Actions runs whose failed jobs a rerun can change, each once. Outside statuses never rerun. */
export function rerunnableRunIds(failures: readonly KnowledgePublicationCheckFailure[]): number[] {
  const ids = failures
    .filter(
      (failure) =>
        failure.kind === "check_run" &&
        failure.runId !== null &&
        TRANSIENT_CONCLUSIONS.has(failure.conclusion),
    )
    .map((failure) => failure.runId!);
  return [...new Set(ids)];
}

/**
 * The next retry record after failed checks on `head`. `rerun` is true when this observation
 * starts the failed runs again; otherwise the attempt count grows and selects the next wait.
 */
export function nextChecksRetry(input: {
  current: KnowledgePublicationChecksRetry | undefined;
  head: string;
  inventoryKey: string;
  rerun: boolean;
  now: Date;
}): KnowledgePublicationChecksRetry {
  if (input.rerun)
    return {
      head: input.head,
      inventoryKey: input.inventoryKey,
      attempts: 0,
      retryAt: input.now.toISOString(),
      rerun: true,
    };
  const attempts = (input.current?.attempts ?? 0) + 1;
  return {
    head: input.head,
    inventoryKey: input.inventoryKey,
    attempts,
    retryAt: new Date(
      input.now.getTime() + knowledgePublicationChecksBackoff(attempts),
    ).toISOString(),
    rerun: input.current?.rerun ?? false,
  };
}

/**
 * Failed checks on the published head `opened.publishedHead`. Transient Actions failures, such as
 * a job that never started, are started again once per head, and the publisher waits for them.
 * Otherwise the result names the failed checks and records a growing wait before the head is read
 * again. A rerun the forge refuses still counts as the one rerun for that head.
 */
export async function recoverFailedKnowledgePublicationChecks(input: {
  forge: Pick<KnowledgePublicationForge, "rerunFailedChecks">;
  now: Date;
  opened: KnowledgePublicationState;
  inventory: Pick<KnowledgePublicationInventory, "base" | "knowledge">;
  checks: Extract<KnowledgePublicationChecks, { state: "failed" }>;
}): Promise<
  | { status: "rerun"; state: KnowledgePublicationState }
  | { status: "failed"; state: KnowledgePublicationState; detail: string }
> {
  const head = input.opened.publishedHead!;
  const inventoryKey = knowledgePublicationInventoryKey(input.inventory);
  let current = input.opened.checksRetry;
  const runIds = current?.rerun === true ? [] : rerunnableRunIds(input.checks.failures);
  if (runIds.length > 0) {
    const started = await input.forge
      .rerunFailedChecks({ number: input.opened.pullRequestNumber!, runIds })
      .then(
        () => true,
        (error: unknown) => {
          if (!(error instanceof KnowledgePublicationForgeError)) throw error;
          return false;
        },
      );
    current = nextChecksRetry({ current, head, inventoryKey, rerun: true, now: input.now });
    if (started)
      return {
        status: "rerun",
        state: { ...input.opened, status: "awaiting_checks", checksRetry: current },
      };
  }
  return {
    status: "failed",
    state: {
      ...input.opened,
      checksRetry: nextChecksRetry({ current, head, inventoryKey, rerun: false, now: input.now }),
    },
    detail: knowledgePublicationChecksDetail(input.checks),
  };
}
