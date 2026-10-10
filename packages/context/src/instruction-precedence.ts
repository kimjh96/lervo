import { isGeneratedInstructionPath, type InstructionSource } from "./instruction-sources.js";

/** Equal-authority owner rules only: explicit acyclic supersession, no inferred priority. */
export function resolveInstructionPrecedence(
  input: readonly InstructionSource[],
): InstructionSource[] {
  const sources = structuredClone([...input]);
  const byId = new Map(
    sources
      .filter((source) => isGeneratedInstructionPath(source.path))
      .map((source) => [source.path.split("/").at(-1)!.replace(/\.md$/u, ""), source]),
  );
  const reachable = (
    from: InstructionSource,
    target: InstructionSource,
    visited = new Set<InstructionSource>(),
  ): boolean => {
    if (visited.has(from)) return false;
    visited.add(from);
    return (from.conditions?.supersedes ?? []).some((id) => {
      const next = byId.get(id);
      return next !== undefined && (next === target || reachable(next, target, visited));
    });
  };
  const active = sources.filter((source) => source.applicability === "applicable");
  for (const source of active) {
    if (!isGeneratedInstructionPath(source.path) && source.conditions?.supersedes.length) {
      source.applicability = "unresolved";
      continue;
    }
    if ((source.conditions?.supersedes ?? []).some((id) => !byId.has(id)))
      source.applicability = "unresolved";
    if (reachable(source, source)) source.applicability = "conflict";
  }
  for (const source of active) {
    if (source.applicability !== "applicable") continue;
    if (
      active.some(
        (other) =>
          other !== source && other.applicability === "applicable" && reachable(other, source),
      )
    )
      source.applicability = "not_applicable";
  }
  const retained = sources.filter((source) => source.applicability === "applicable");
  for (const source of retained) {
    const decision = source.conditions?.decision;
    if (
      decision &&
      retained.some(
        (other) =>
          other.conditions?.decision?.key === decision.key &&
          other.conditions.decision.value !== decision.value,
      )
    )
      source.applicability = "conflict";
  }
  return sources;
}
