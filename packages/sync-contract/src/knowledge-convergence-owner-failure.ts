/**
 * ADR-0466 cause of a convergence owner lease request that proved nothing. The Hub client attaches
 * one code to every failure, so an `unverifiable` verdict names why instead of hiding it.
 *
 * - `hub_unauthorized`: the Hub answered 401; it did not accept the bearer token.
 * - `hub_forbidden`: the Hub answered 403; the token's principal lacks the project scope or the
 *   `workspace.read` / `workspace.coordinate` permission.
 * - `hub_unreachable`: no answer, a timeout, or a 5xx status.
 * - `hub_identity_mismatch`: the answer did not carry the configured Hub identity.
 * - `hub_response_invalid`: an unexpected status, content type, or body.
 * - `hub_configuration_invalid`: the configured coordinates or token cannot form a request.
 * - `token_file_unreadable`: the owner-only bearer token file could not be read safely.
 * - `hub_request_failed`: any failure the adapter did not classify.
 */
export type KnowledgeConvergenceOwnerFailureCode =
  | "hub_unauthorized"
  | "hub_forbidden"
  | "hub_unreachable"
  | "hub_identity_mismatch"
  | "hub_response_invalid"
  | "hub_configuration_invalid"
  | "token_file_unreadable"
  | "hub_request_failed";

export const KNOWLEDGE_CONVERGENCE_OWNER_FAILURE_CODES: ReadonlySet<string> =
  new Set<KnowledgeConvergenceOwnerFailureCode>([
    "hub_unauthorized",
    "hub_forbidden",
    "hub_unreachable",
    "hub_identity_mismatch",
    "hub_response_invalid",
    "hub_configuration_invalid",
    "token_file_unreadable",
    "hub_request_failed",
  ]);

/** Privacy-safe: a closed code and an HTTP status, never a message, URL, or token path. */
export interface KnowledgeConvergenceOwnerFailure {
  failureCode: KnowledgeConvergenceOwnerFailureCode;
  /** The Hub's HTTP status when it answered with one, else null. */
  httpStatus: number | null;
}

export function isKnowledgeConvergenceOwnerHttpStatus(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 100 && (value as number) <= 599;
}

/**
 * Reads the failure a lease port attached to a thrown error. An error without a known code is
 * `hub_request_failed`, so an unclassified failure still reads as "not proven".
 */
export function knowledgeConvergenceOwnerFailureOf(
  error: unknown,
): KnowledgeConvergenceOwnerFailure {
  const value = error as { failureCode?: unknown; httpStatus?: unknown } | null;
  const failureCode =
    typeof value?.failureCode === "string" &&
    KNOWLEDGE_CONVERGENCE_OWNER_FAILURE_CODES.has(value.failureCode)
      ? (value.failureCode as KnowledgeConvergenceOwnerFailureCode)
      : "hub_request_failed";
  return {
    failureCode,
    httpStatus: isKnowledgeConvergenceOwnerHttpStatus(value?.httpStatus) ? value.httpStatus : null,
  };
}
