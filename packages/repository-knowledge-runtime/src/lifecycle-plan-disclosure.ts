/**
 * ADR-0481: what an exact lifecycle plan reviewer is shown. Operations the plan itself marks
 * `lervo_generated` are rebuildable projections such as the knowledge inventory and structural
 * concepts. Deterministic code produces their bytes, and no reviewer judgement can preserve or lose
 * owner meaning in them, so the reviewer sees their path and hashes but not their bytes. The plan
 * hash still binds every byte of the complete plan.
 */
interface PlanOperation {
  path?: unknown;
  ownership?: unknown;
  destinationPath?: unknown;
  content?: unknown;
}

function operations(plan: unknown): PlanOperation[] {
  const value = (plan as { operations?: unknown } | null)?.operations;
  return Array.isArray(value)
    ? value.filter((item): item is PlanOperation => item !== null && typeof item === "object")
    : [];
}

function generated(operation: PlanOperation): boolean {
  return (
    operation.ownership === "lervo_generated" &&
    typeof operation.path === "string" &&
    operation.destinationPath === undefined
  );
}

/** Changed paths whose bytes only Lervo's deterministic projection writes. */
export function generatedLifecyclePlanPaths(plan: unknown): Set<string> {
  return new Set(
    operations(plan)
      .filter(generated)
      .map((operation) => operation.path as string),
  );
}

/** The plan as disclosed: generated operations keep their hashes and drop their bytes. */
export function disclosedLifecyclePlan(plan: unknown): unknown {
  const value = (plan as { operations?: unknown } | null)?.operations;
  if (!Array.isArray(value)) return plan;
  return {
    ...(plan as Record<string, unknown>),
    operations: value.map((operation: PlanOperation) => {
      if (operation === null || typeof operation !== "object" || !generated(operation))
        return operation;
      const { content, ...disclosed } = operation;
      return content === undefined ? operation : { ...disclosed, contentDisclosed: false };
    }),
  };
}
