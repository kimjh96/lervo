import type { VerificationResult } from "@lervo/schemas";

import { convergenceVerificationFailure } from "./verification-outcome.js";

/**
 * The orchestrator reports every failed candidate suite as `verification_failed`, the same code it
 * uses when a stored result or its output cannot be read back intact. This tracker names the first
 * failed command, as every other convergence suite does (ADR-0562 section 3), but only when the
 * orchestrator accepted every suite's result: it appends `verification.completed` only after the
 * stored result validated. Any other `verification_failed` keeps its own cause.
 */
export function integrationVerificationFailure(suiteCount: number) {
  const observed = new Map<string, Error | null>();
  const accepted: (Error | null)[] = [];
  return {
    /** A suite result the verifier produced, before the orchestrator validates it. */
    observe(result: Pick<VerificationResult, "status" | "commands">, resultArtifactHash: string) {
      observed.set(resultArtifactHash, convergenceVerificationFailure(result, resultArtifactHash));
    },
    /** Events the orchestrator appends; a completed suite's result passed validation. */
    accept(specs: readonly { type: string; payload: Record<string, unknown> }[]) {
      for (const spec of specs) {
        const hash = spec.payload.resultContentHash;
        if (
          spec.type === "verification.completed" &&
          typeof hash === "string" &&
          observed.has(hash)
        )
          accepted.push(observed.get(hash)!);
      }
    },
    /** The error to report for a failure of the verification effect. */
    classify(error: unknown): unknown {
      if ((error as { code?: unknown } | null)?.code !== "verification_failed") return error;
      if (accepted.length !== suiteCount) return error;
      return accepted.find((failure) => failure !== null) ?? error;
    },
  };
}
