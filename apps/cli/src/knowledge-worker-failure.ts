const FAILURE_CODE = /^[a-z][a-z0-9_]{0,63}$/u;
const MAXIMUM_DETAIL_CHARACTERS = 300;
/** Lervo-authored failures whose messages name a repository path or step, never source bodies. */
const TYPED_FAILURES = new Set(["RepositoryKnowledgeError", "KnowledgeConvergenceRuntimeError"]);

/**
 * One bounded line per failed resident cycle for the owner-only worker log. The code stays the
 * stable classifier. A typed Lervo failure adds its message, so a concurrent edit or unsafe
 * source names the path that caused it; native and provider errors stay code-only.
 */
export function knowledgeWorkerFailureLine(error: unknown, repositoryRoot: string): string {
  const raw = (error as { code?: unknown } | null)?.code;
  const code =
    typeof raw === "string" && FAILURE_CODE.test(raw) ? raw : "knowledge_job_transient_failure";
  const message = error instanceof Error && TYPED_FAILURES.has(error.name) ? error.message : "";
  const detail = (repositoryRoot.length > 1 ? message.split(repositoryRoot).join(".") : message)
    .replace(/[\r\n\0]+/gu, " ")
    .trim()
    .slice(0, MAXIMUM_DETAIL_CHARACTERS);
  // A host resident serves many checkouts from one log, so every line names its checkout.
  const subject =
    repositoryRoot.length > 0
      ? `Knowledge convergence failed in ${repositoryRoot.replace(/[\r\n\0]+/gu, " ")}`
      : "Host knowledge resident scan failed";
  return `${subject}: ${code}${detail ? ` (${detail})` : ""}\n`;
}
