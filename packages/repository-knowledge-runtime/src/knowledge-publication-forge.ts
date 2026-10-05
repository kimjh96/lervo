/**
 * The code-review host that receives knowledge publication pull requests. The GitHub CLI adapter
 * implements it; tests use an in-memory fake. Every method throws on any transport failure.
 */
export interface KnowledgePublicationPullRequest {
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
  headSha: string;
  title: string;
  body: string;
}

/**
 * - `pending`: at least one check has not finished, or none has been reported yet.
 * - `passed`: every reported check finished with success, neutral, or skipped.
 * - `failed`: at least one check finished with any other conclusion.
 */
export type KnowledgePublicationChecks =
  | { state: "pending"; total: number }
  | { state: "passed"; total: number }
  | { state: "failed"; total: number; failed: number };

export interface KnowledgePublicationForge {
  findPullRequest(input: {
    head: string;
    base: string;
  }): Promise<KnowledgePublicationPullRequest | null>;
  createPullRequest(input: {
    head: string;
    base: string;
    title: string;
    body: string;
  }): Promise<KnowledgePublicationPullRequest>;
  updatePullRequest(input: { number: number; title: string; body: string }): Promise<void>;
  viewPullRequest(number: number): Promise<KnowledgePublicationPullRequest>;
  /** Closes an open pull request with an explanatory comment; the branch stays for the next push. */
  closePullRequest(input: { number: number; comment: string }): Promise<void>;
  checks(input: { number: number; headSha: string }): Promise<KnowledgePublicationChecks>;
  /** Merges with a merge commit only if the head is still exactly `headSha`. */
  merge(input: { number: number; headSha: string }): Promise<void>;
}
