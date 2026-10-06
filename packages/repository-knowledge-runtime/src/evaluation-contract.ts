import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { KNOWLEDGE_STAGE_FAILURE_EVALUATION_CONTRACT } from "@lervo/repository-knowledge";

let cached: string | null = null;

/**
 * ADR-0485: the identity of the evaluation logic that settled a stalled stage. It is the exact
 * bytes of the module that holds this runtime's stage evaluation: the bundled runtime when
 * installed, or this source file in development. Every deploy of new logic therefore changes it, so
 * each settled stall is reevaluated once by the new logic and then stays settled under it. When the
 * bytes cannot be read, the reviewed constant still names the contract.
 */
export function convergenceEvaluationContract(): string {
  if (cached !== null) return cached;
  try {
    const digest = createHash("sha256")
      .update(readFileSync(fileURLToPath(import.meta.url)))
      .digest("hex")
      .slice(0, 24);
    cached = `${KNOWLEDGE_STAGE_FAILURE_EVALUATION_CONTRACT}:${digest}`;
  } catch {
    cached = KNOWLEDGE_STAGE_FAILURE_EVALUATION_CONTRACT;
  }
  return cached;
}

/**
 * A settled dependency records the contract that evaluated it. One recorded under any other
 * contract, or before contracts existed, is reevaluated once by the current logic.
 */
export function settledUnderEarlierContract(
  dependency: { evaluationContract?: unknown; [key: string]: unknown },
  current = convergenceEvaluationContract(),
): boolean {
  return dependency.evaluationContract !== current;
}
