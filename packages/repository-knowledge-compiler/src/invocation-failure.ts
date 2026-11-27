import {
  NoCapabilityInvocationFailure,
  parseNoCapabilityResultText,
} from "@lervo/adapter-contract";
import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";

/** An adapter's typed run failure as this package's failure, with the same code and details. */
export function knowledgeInvocationFailure(error: unknown): unknown {
  if (!(error instanceof NoCapabilityInvocationFailure)) return error;
  return Object.assign(
    new RepositoryKnowledgeError(
      error.kind === "policy_violation"
        ? "knowledge_compile_policy_violation"
        : "knowledge_compile_failed",
      error.message,
      undefined,
      error.cause === undefined ? undefined : { cause: error.cause },
    ),
    error.details,
  );
}

export function withKnowledgeInvocationFailures<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw knowledgeInvocationFailure(error);
  }
}

export function parseProviderResultText(value: string, provider: "Codex" | "Claude"): unknown {
  return withKnowledgeInvocationFailures(() => parseNoCapabilityResultText(value, provider));
}
