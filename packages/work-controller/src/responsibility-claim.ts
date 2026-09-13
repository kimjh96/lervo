import { repositoryPathWithinScope } from "./repository-path-scope.js";
import type { WorkResponsibilityV1 } from "@lervo/application-contract";
import { digest } from "./hash.js";
import { assertWorkResponsibility, operatingTime } from "./operating-contract-validation.js";

/** Actual source before claim; the proposed responsibility binds the resulting revision. */
export interface ResponsibilityClaimSource {
  assignmentId: string;
  revision: number;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  expectedPaths: string[];
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  liveLease: boolean;
  predecessorBindingHash: string | null;
}

export function evaluateResponsibilityClaim(input: {
  source: ResponsibilityClaimSource;
  responsibility: WorkResponsibilityV1;
  maximumDeadlineMs: number;
  now: string;
}): { status: "ready" | "blocked"; reasonCodes: string[] } {
  const { source, responsibility: task } = input;
  assertWorkResponsibility(task);
  if (
    !operatingTime(input.now) ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 1 ||
    !Number.isSafeInteger(input.maximumDeadlineMs) ||
    input.maximumDeadlineMs < 1
  )
    throw new TypeError("Invalid responsibility claim source or time.");
  const reasons = evaluateResponsibilityClaimScope(source, task);
  if (source.liveLease) reasons.push("responsibility_lease_unresolved");
  if (task.predecessorBindingHash !== source.predecessorBindingHash)
    reasons.push("responsibility_changed");
  if (
    Date.parse(task.startDeadline) <= Date.parse(input.now) ||
    Date.parse(task.completionDeadline) - Date.parse(input.now) > input.maximumDeadlineMs
  )
    reasons.push("deadline_outside_mandate");
  return { status: reasons.length === 0 ? "ready" : "blocked", reasonCodes: reasons };
}

/** Structural claim binding only; canonical predecessor, deadlines and authority belong to admission. */
export function evaluateResponsibilityClaimScope(
  source: Omit<ResponsibilityClaimSource, "liveLease" | "predecessorBindingHash">,
  task: WorkResponsibilityV1,
): string[] {
  assertWorkResponsibility(task);
  const reasons: string[] = [];
  if (task.assignmentId !== source.assignmentId || task.assignmentRevision !== source.revision + 1)
    reasons.push("assignment_claim_revision_changed");
  if (
    task.roleId !== source.roleId ||
    task.roleVersion !== source.roleVersion ||
    task.roleContractHash !== source.roleContractHash
  )
    reasons.push("role_binding_changed");
  if (
    digest(task.acceptanceCriteria) !== digest(source.acceptanceCriteria) ||
    digest([...task.verificationSuiteIds].sort()) !==
      digest([...source.verificationSuiteIds].sort()) ||
    task.expectedPaths.some(
      (path) => !source.expectedPaths.some((scope) => repositoryPathWithinScope(path, scope)),
    )
  )
    reasons.push("assignment_claim_scope_changed");
  return reasons;
}
