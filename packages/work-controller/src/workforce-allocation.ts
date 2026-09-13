import { operatingContractHash } from "./operating-mandate-admission.js";

export interface WorkforceAllocationCandidate {
  agentId: string;
  isOwner: boolean;
  status: "available" | "busy" | "incompatible" | "unobserved";
  sourceHash: string;
  reasonCodes: string[];
}

/** Chooses among observed staff; this does not admit hiring, borrowing, or provider execution. */
export function selectWorkforceAllocation(input: {
  sourceHash: string;
  candidates: WorkforceAllocationCandidate[];
  environment: "ready" | "failed" | "unobserved";
}) {
  if (
    !/^sha256:[a-f0-9]{64}$/u.test(input.sourceHash) ||
    !["ready", "failed", "unobserved"].includes(input.environment) ||
    !Array.isArray(input.candidates) ||
    input.candidates.length > 256 ||
    new Set(input.candidates.map((item) => item.agentId)).size !== input.candidates.length ||
    input.candidates.some(
      (item) =>
        !/^agt_[a-f0-9]{24}$/u.test(item.agentId) ||
        typeof item.isOwner !== "boolean" ||
        !/^sha256:[a-f0-9]{64}$/u.test(item.sourceHash) ||
        !["available", "busy", "incompatible", "unobserved"].includes(item.status) ||
        !Array.isArray(item.reasonCodes) ||
        item.reasonCodes.length > 16 ||
        item.reasonCodes.some((reason) => !/^[a-z][a-z0-9_]{0,63}$/u.test(reason)),
    ) ||
    input.candidates.filter((item) => item.isOwner).length > 1
  )
    throw new TypeError("The workforce allocation observation is invalid.");
  const candidates = structuredClone(input.candidates).sort(
    (a, b) => Number(a.isOwner) - Number(b.isOwner) || a.agentId.localeCompare(b.agentId),
  );
  const available = candidates.find((item) => item.status === "available");
  const unknown = candidates.some((item) => item.status === "unobserved");
  const busy = candidates.some((item) => item.status === "busy");
  const result =
    input.environment !== "ready"
      ? {
          disposition: "blocked" as const,
          agentId: null,
          reasonCode: `environment_${input.environment}`,
        }
      : available !== undefined
        ? {
            disposition: available.isOwner
              ? ("execute_as_owner" as const)
              : ("reuse_existing" as const),
            agentId: available.agentId,
            reasonCode: "qualified_available_staff",
          }
        : unknown
          ? {
              disposition: "blocked" as const,
              agentId: null,
              reasonCode: "staff_readiness_unobserved",
            }
          : busy
            ? {
                disposition: "capacity_gap" as const,
                agentId: null,
                reasonCode: "qualified_staff_busy",
              }
            : {
                disposition: "skill_gap" as const,
                agentId: null,
                reasonCode: "no_qualified_staff",
              };
  const content = {
    schemaVersion: 1 as const,
    kind: "workforce.allocation_observation" as const,
    sourceHash: input.sourceHash,
    ...result,
    candidates,
    alternatives: [
      {
        kind: "reuse_existing",
        disposition: candidates.some((item) => !item.isOwner && item.status === "available")
          ? "available"
          : "unavailable",
      },
      {
        kind: "execute_as_owner",
        disposition: candidates.some((item) => item.isOwner && item.status === "available")
          ? "available"
          : "unavailable",
      },
      { kind: "reassign", disposition: busy ? "lease_reconciliation_required" : "unavailable" },
      {
        kind: "request_team_support",
        disposition: result.disposition.endsWith("gap")
          ? "scoped_handoff_required"
          : "not_selected",
      },
      {
        kind: "hire_worker",
        disposition: result.disposition.endsWith("gap")
          ? "mandate_and_capacity_review_required"
          : "not_selected",
      },
    ],
  };
  return { ...content, observationHash: operatingContractHash(content) };
}
