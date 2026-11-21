import { createHash } from "node:crypto";

/**
 * ADR-0602 and ADR-0603: how long the publisher waits on GitHub-side state that sends no push,
 * such as checks that have not finished, a merge gate, or a person's review. It looks again at a
 * growing interval, then arms no timer: the wait becomes named attention, and the pull request is
 * read again only when a cycle runs for another reason, such as a local change, a Hub push, or a
 * deadline. Nothing polls GitHub forever.
 */

/** What a publication waits on. */
export type KnowledgePublicationWaitKind = "checks" | "gate" | "review";

export interface KnowledgePublicationWait {
  /**
   * The pull request and the digest of the knowledge commits it carries. Only a new pull request
   * or a new set of commits starts over: a head rebuilt on a moved base, or a change of kind,
   * continues the same wait, so a busy repository cannot keep it from running out.
   */
  pullRequestNumber: number;
  carried: string;
  /** The head the latest look saw. */
  head: string;
  kind: KnowledgePublicationWaitKind;
  /** The forge's latest reason, such as `none`, `skipped_only`, `draft`, or `blocked`. */
  reason: string;
  /** Looks at this head for this kind, including the current one. */
  attempts: number;
  since: string;
}

const MINUTE = 60_000;

/** Checks and merge gates: 2 minutes, doubling to an hour. Reviews: 15 minutes, then an hour. */
export const KNOWLEDGE_PUBLICATION_WAIT_STEPS_MS: Record<
  KnowledgePublicationWaitKind,
  readonly number[]
> = {
  checks: [2, 4, 8, 16, 32, 60].map((minutes) => minutes * MINUTE),
  gate: [2, 4, 8, 16, 32, 60].map((minutes) => minutes * MINUTE),
  review: [15, 60].map((minutes) => minutes * MINUTE),
};

/** Digest of the carried commits, order kept, which keys a wait. */
export function knowledgePublicationCarriedDigest(commits: readonly string[]): string {
  return `sha256:${createHash("sha256").update(commits.join("\n")).digest("hex")}`;
}

/** The wait after one more look; the same pull request and commits continue it. */
export function nextKnowledgePublicationWait(
  previous: KnowledgePublicationWait | undefined,
  input: {
    pullRequestNumber: number;
    carried: string;
    head: string;
    kind: KnowledgePublicationWaitKind;
    reason: string;
    now: Date;
  },
): KnowledgePublicationWait {
  const same = sameKnowledgePublicationWait(previous, input);
  return {
    pullRequestNumber: input.pullRequestNumber,
    carried: input.carried,
    head: input.head,
    kind: input.kind,
    reason: input.reason,
    attempts: same ? Math.min(previous.attempts + 1, 1_000_000) : 1,
    since: same ? previous.since : input.now.toISOString(),
  };
}

/** Whether `previous` is the wait for this pull request and these commits. */
export function sameKnowledgePublicationWait(
  previous: KnowledgePublicationWait | undefined,
  input: { pullRequestNumber: number; carried: string },
): previous is KnowledgePublicationWait {
  return (
    previous !== undefined &&
    previous.pullRequestNumber === input.pullRequestNumber &&
    previous.carried === input.carried
  );
}

/**
 * The delay before the next look, or null once the schedule is spent and no timer is armed. The
 * looks count across kinds, so alternating between checks and a gate still runs out.
 */
export function knowledgePublicationWaitDelay(wait: KnowledgePublicationWait): number | null {
  return KNOWLEDGE_PUBLICATION_WAIT_STEPS_MS[wait.kind][wait.attempts - 1] ?? null;
}

/** Whether the wait spent its schedule and is now attention. */
export function knowledgePublicationWaitExhausted(wait: KnowledgePublicationWait): boolean {
  return knowledgePublicationWaitDelay(wait) === null;
}

const KINDS = new Set(["checks", "gate", "review"]);

export function validKnowledgePublicationWait(value: unknown): value is KnowledgePublicationWait {
  const wait = value as Partial<KnowledgePublicationWait> | null;
  return (
    wait !== null &&
    typeof wait === "object" &&
    Number.isSafeInteger(wait.pullRequestNumber) &&
    typeof wait.carried === "string" &&
    /^sha256:[0-9a-f]{64}$/u.test(wait.carried) &&
    typeof wait.head === "string" &&
    /^[0-9a-f]{40,64}$/u.test(wait.head) &&
    typeof wait.kind === "string" &&
    KINDS.has(wait.kind) &&
    typeof wait.reason === "string" &&
    /^[a-z_]{1,32}$/u.test(wait.reason) &&
    Number.isSafeInteger(wait.attempts) &&
    wait.attempts! >= 1 &&
    typeof wait.since === "string" &&
    !Number.isNaN(Date.parse(wait.since))
  );
}
