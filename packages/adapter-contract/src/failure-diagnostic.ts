/** Bounded provider-transport evidence for the private managed-run diagnostic artifact. */
export interface ProviderFailureDiagnostic {
  provider: "codex" | "claude";
  operation:
    | "session_initialize"
    | "session_start"
    | "context_inject"
    | "capability_status"
    | "turn_start"
    | "turn_interrupt"
    | "session_stop"
    | "other";
  failureKind:
    | "server_rejected"
    | "response_timeout"
    | "process_exited"
    | "process_unavailable"
    | "invalid_message";
  transportCode: number | null;
}

const operations = new Set<ProviderFailureDiagnostic["operation"]>([
  "session_initialize",
  "session_start",
  "context_inject",
  "capability_status",
  "turn_start",
  "turn_interrupt",
  "session_stop",
  "other",
]);
const failureKinds = new Set<ProviderFailureDiagnostic["failureKind"]>([
  "server_rejected",
  "response_timeout",
  "process_exited",
  "process_unavailable",
  "invalid_message",
]);

/** Rejects arbitrary error text or objects before they can enter a persistent artifact. */
export function readProviderFailureDiagnostic(error: unknown): ProviderFailureDiagnostic | null {
  if (typeof error !== "object" || error === null || !("providerFailureDiagnostic" in error))
    return null;
  const value = error.providerFailureDiagnostic;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).toSorted().join(",") !==
      "failureKind,operation,provider,transportCode" ||
    (candidate.provider !== "codex" && candidate.provider !== "claude") ||
    !operations.has(candidate.operation as ProviderFailureDiagnostic["operation"]) ||
    !failureKinds.has(candidate.failureKind as ProviderFailureDiagnostic["failureKind"]) ||
    (candidate.transportCode !== null &&
      (!Number.isSafeInteger(candidate.transportCode) ||
        (candidate.transportCode as number) < -2_147_483_648 ||
        (candidate.transportCode as number) > 2_147_483_647)) ||
    (candidate.failureKind !== "server_rejected" && candidate.transportCode !== null)
  )
    return null;
  return {
    provider: candidate.provider,
    operation: candidate.operation as ProviderFailureDiagnostic["operation"],
    failureKind: candidate.failureKind as ProviderFailureDiagnostic["failureKind"],
    transportCode: candidate.transportCode as number | null,
  };
}
