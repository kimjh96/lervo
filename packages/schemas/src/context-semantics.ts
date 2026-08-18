import type { ContextScope } from "./common.js";

export function contextScopesEqual(left: ContextScope, right: ContextScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "full" || right.kind === "full") return true;
  return (
    left.sections.length === right.sections.length &&
    left.sections.every((section) => right.sections.includes(section))
  );
}

export function cloneContextScope(scope: ContextScope): ContextScope {
  return scope.kind === "full"
    ? { kind: "full" }
    : { kind: "sections", sections: [...scope.sections] };
}
