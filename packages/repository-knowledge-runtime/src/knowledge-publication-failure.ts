import {
  KnowledgePublicationForgeError,
  TRANSIENT_FORGE_FAILURES,
} from "./knowledge-publication-forge.js";
import { KnowledgePublicationGitError } from "./knowledge-publication-git.js";
import type { KnowledgePublicationFailureCode } from "./knowledge-publication-state.js";
import { KNOWLEDGE_PUBLICATION_WAIT_STEPS_MS } from "./knowledge-publication-wait.js";

/**
 * One publication failure with its state code. ADR-0603: `transient` says whether a later attempt
 * can clear it on its own, which decides whether it is retried at a backoff deadline or waits for
 * a change while it stays attention.
 */
export class PublicationFailure extends Error {
  readonly transient: boolean;

  constructor(
    readonly code: KnowledgePublicationFailureCode,
    readonly detail: string | null,
    options?: ErrorOptions & { transient?: boolean },
  ) {
    super(code, options);
    this.transient = options?.transient ?? transientCause(options?.cause);
  }
}

/** A push the forge refused for a ruleset (GH013) or branch protection (GH006). */
const RULE_REFUSAL = /\bGH0(?:13|06)\b|repository rule violations|protected branch hook declined/iu;

function ruleRefusal(error: KnowledgePublicationGitError): boolean {
  const stderr = (error.cause as { stderr?: unknown } | undefined)?.stderr;
  return RULE_REFUSAL.test(typeof stderr === "string" ? stderr : String(stderr ?? ""));
}

/**
 * Whether a cause can clear without a person: a forge failure of a transient class, or a Git fetch
 * or push, which fails on the network. A push a ruleset or protection refused needs a person.
 */
export function transientCause(cause: unknown): boolean {
  if (cause instanceof KnowledgePublicationForgeError)
    return TRANSIENT_FORGE_FAILURES.has(cause.failureClass);
  if (cause instanceof KnowledgePublicationGitError)
    return cause.stage === "fetch" || (cause.stage === "push" && !ruleRefusal(cause));
  return false;
}

/** Path-free detail of a Git or forge failure: the step, the exit code, and the forge's class. */
export function failureDetail(error: unknown): string | null {
  if (error instanceof KnowledgePublicationGitError)
    return `git ${error.stage} exit ${error.exitCode ?? "unknown"}${
      ruleRefusal(error) ? " rule_refusal" : ""
    }`;
  if (error instanceof KnowledgePublicationForgeError) return error.detail;
  return null;
}

export async function step<T>(
  code: KnowledgePublicationFailureCode,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PublicationFailure) throw error;
    throw new PublicationFailure(code, failureDetail(error), { cause: error });
  }
}

/**
 * ADR-0603: a transient failure is tried again after 2 minutes, doubling to an hour. After that no
 * timer is armed (ADR-0602): the failure stays attention, and the next cycle that runs for another
 * reason tries again.
 */
export function knowledgePublicationRetryDelay(occurrences: number): number | null {
  return KNOWLEDGE_PUBLICATION_WAIT_STEPS_MS.gate[Math.max(occurrences, 1) - 1] ?? null;
}
