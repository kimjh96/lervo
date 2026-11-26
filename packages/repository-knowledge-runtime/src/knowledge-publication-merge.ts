import {
  KnowledgePublicationForgeError,
  type KnowledgePublicationForge,
} from "./knowledge-publication-forge.js";
import { PublicationFailure, step } from "./knowledge-publication-failure.js";
import type { KnowledgePublicationMergeMethod } from "./knowledge-publication-policy.js";

/**
 * - `merged`: the forge reports the pull request merged. `mergeCommit` is null while the forge
 *   has not reported it yet; the commits count as published once GitHub's pull request head shows
 *   them (ADR-0607), whatever the body says.
 * - `waiting`: something on the forge stands before the merge, named by `reason`: a gate such as
 *   `behind`, `blocked`, `conflict`, `draft`, or `queued`, or a person's review (`review`).
 */
export type KnowledgePublicationMergeOutcome =
  | { status: "merged"; mergeCommit: string | null }
  | { status: "waiting"; kind: "gate" | "review"; reason: string };

/**
 * ADR-0603: merges a publication whose checks passed, with the method the repository policy
 * allows, once the forge says nothing else stands before it. A base with a merge queue is entered
 * through the queue. A refusal of the method itself is a policy refusal, which needs a person; any
 * other refusal is a merge failure of its own class. A merge counts only once the forge reports
 * the pull request merged; a command that succeeds without merging and without a queue fails.
 */
export async function mergeKnowledgePublication(input: {
  forge: KnowledgePublicationForge;
  number: number;
  headSha: string;
  method: KnowledgePublicationMergeMethod | "queue";
  /**
   * A host-side reason to hold the merge, such as a CLI release train between its cut and its tag:
   * a merge then would supersede the release's preparation. Null merges as usual; a failing check
   * never holds.
   */
  hold?: () => Promise<string | null>;
}): Promise<KnowledgePublicationMergeOutcome> {
  const held = await input.hold?.().catch(() => null);
  if (held) return { status: "waiting", kind: "gate", reason: held };
  const gate = await step("knowledge_publication_merge_failed", () =>
    input.forge.gate(input.number),
  );
  if (gate === "review_required") return { status: "waiting", kind: "review", reason: gate };
  if (gate !== "ready" && gate !== "queue")
    return { status: "waiting", kind: "gate", reason: gate };
  const method = gate === "queue" ? "queue" : input.method;
  const attempted = await step("knowledge_publication_merge_failed", () =>
    input.forge.merge({ number: input.number, headSha: input.headSha, method }).then(
      () => "attempted" as const,
      (error: unknown) => {
        if (!(error instanceof KnowledgePublicationForgeError)) throw error;
        // GitHub can still count a check as running after the rollup reported it finished.
        if (error.failureClass === "checks_pending") return "waiting" as const;
        if (error.failureClass === "checks_failed")
          throw new PublicationFailure("knowledge_publication_checks_failed", error.detail, {
            cause: error,
          });
        if (error.failureClass === "method_not_allowed")
          throw new PublicationFailure("knowledge_publication_policy_refused", error.detail, {
            cause: error,
            transient: false,
          });
        throw error;
      },
    ),
  );
  if (attempted === "waiting")
    return { status: "waiting", kind: "gate", reason: "checks_settling" };
  const merged = await step("knowledge_publication_merge_failed", () =>
    input.forge.viewPullRequest(input.number),
  );
  if (merged.state === "merged") return { status: "merged", mergeCommit: merged.mergeCommit };
  if (method === "queue" && merged.state === "open")
    return { status: "waiting", kind: "gate", reason: "queued" };
  throw new PublicationFailure(
    "knowledge_publication_merge_failed",
    `the merge command succeeded but the pull request is ${merged.state}`,
    { transient: true },
  );
}
