import { residentCycleFailure } from "@lervo/repository-knowledge-runtime";

/**
 * One bounded line per failed resident cycle for the owner-only worker log. The code stays the
 * stable classifier. A typed Lervo failure adds its message, so a concurrent edit or unsafe
 * source names the path that caused it; native and provider errors stay code-only.
 */
export function knowledgeWorkerFailureLine(error: unknown, repositoryRoot: string): string {
  const { code, detail } = residentCycleFailure(error, repositoryRoot);
  // A host resident serves many checkouts from one log, so every line names its checkout.
  const subject =
    repositoryRoot.length > 0
      ? `Knowledge convergence failed in ${repositoryRoot.replace(/[\r\n\0]+/gu, " ")}`
      : "Host knowledge resident scan failed";
  return `${subject}: ${code}${detail ? ` (${detail})` : ""}\n`;
}
