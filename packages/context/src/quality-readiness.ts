import { contextQualityBindingNames, type ContextQualityReadiness } from "@lervo/schemas";

import { ContextQualityError } from "./quality-request.js";

/** Lists missing owner observations; possessing a digest alone does not resolve a binding. */
export function unavailableContextQualityBindings(
  missing: readonly ContextQualityReadiness["missingBindings"][number][] = contextQualityBindingNames,
): ContextQualityReadiness {
  if (
    missing.length === 0 ||
    missing.length > contextQualityBindingNames.length ||
    missing.some((name) => !contextQualityBindingNames.includes(name)) ||
    new Set(missing).size !== missing.length
  )
    throw new ContextQualityError("context_contract_invalid");
  return {
    status: "unavailable",
    reasonCode: "context_binding_unavailable",
    missingBindings: [...missing].sort(),
  };
}
