import type { ResidentCycleFailure } from "./resident-cycle-state.js";

export const RESIDENT_FAILURE_CODE = /^[a-z][a-z0-9_]{2,80}$/u;
const TYPED_FAILURES = new Set(["RepositoryKnowledgeError", "KnowledgeConvergenceRuntimeError"]);

/** ADR-0465: only Lervo-authored messages may enter owner-only local diagnostics. */
export function residentCycleFailure(
  error: unknown,
  repositoryRoot: string,
): Pick<ResidentCycleFailure, "code" | "detail"> {
  const raw = (error as { code?: unknown } | null)?.code;
  const code =
    typeof raw === "string" && RESIDENT_FAILURE_CODE.test(raw) ? raw : "unclassified_failure";
  const message = error instanceof Error && TYPED_FAILURES.has(error.name) ? error.message : "";
  const detail = (repositoryRoot.length > 1 ? message.split(repositoryRoot).join(".") : message)
    .replace(/[\r\n\0]+/gu, " ")
    .trim()
    .slice(0, 300);
  return { code, detail: detail || null };
}
