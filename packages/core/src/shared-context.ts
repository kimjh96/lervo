import type { HandoffBundle, RoleProfile, SharedContextPublication } from "@lervo/schemas";

import type { RequiredContextDocument } from "./assurance.js";

export type SharedContextAccessDecision =
  | { allowed: true; reason: "project_visible" | "role_visible" }
  | {
      allowed: false;
      reason: "expired" | "not_yet_published" | "role_not_allowed";
    };

export type HandoffViolationCode =
  | "producer_role_mismatch"
  | "recipient_role_not_allowed"
  | "context_missing"
  | "context_project_mismatch"
  | "context_not_readable"
  | "context_expired"
  | "context_not_yet_published"
  | "context_superseded";

export interface HandoffViolation {
  code: HandoffViolationCode;
  sharedContextId?: string;
}

export type HandoffContextDecision =
  | {
      allowed: true;
      requiredDocuments: RequiredContextDocument[];
      violations: [];
    }
  | {
      allowed: false;
      failure: "contract_validation_failed" | "required_context_missing";
      requiredDocuments: [];
      violations: HandoffViolation[];
    };

export function decideSharedContextAccess(input: {
  publication: SharedContextPublication;
  roleId: string;
  at: Date;
}): SharedContextAccessDecision {
  if (Date.parse(input.publication.publishedAt) > input.at.getTime()) {
    return { allowed: false, reason: "not_yet_published" };
  }
  if (
    input.publication.expiresAt !== null &&
    Date.parse(input.publication.expiresAt) <= input.at.getTime()
  ) {
    return { allowed: false, reason: "expired" };
  }
  if (input.publication.audience.mode === "project") {
    return { allowed: true, reason: "project_visible" };
  }
  if (input.publication.audience.roleIds.includes(input.roleId)) {
    return { allowed: true, reason: "role_visible" };
  }
  return { allowed: false, reason: "role_not_allowed" };
}

export function resolveHandoffContext(input: {
  handoff: HandoffBundle;
  producerRole: RoleProfile;
  publications: readonly SharedContextPublication[];
  at: Date;
}): HandoffContextDecision {
  const violations: HandoffViolation[] = [];
  if (input.handoff.from.roleId !== input.producerRole.roleId) {
    violations.push({ code: "producer_role_mismatch" });
  }
  if (!input.producerRole.handoff.allowedRoleIds.includes(input.handoff.toRoleId)) {
    violations.push({ code: "recipient_role_not_allowed" });
  }

  const publications = new Map(
    input.publications.map((publication) => [publication.sharedContextId, publication]),
  );
  const supersededContextIds = new Set(
    input.publications
      .filter((publication) => publication.projectId === input.handoff.projectId)
      .filter((publication) => Date.parse(publication.publishedAt) <= input.at.getTime())
      .map((publication) => publication.supersedesSharedContextId)
      .filter((sharedContextId): sharedContextId is string => sharedContextId !== null),
  );
  const requiredDocuments: RequiredContextDocument[] = [];
  for (const sharedContextId of input.handoff.sharedContextIds) {
    const publication = publications.get(sharedContextId);
    if (!publication) {
      violations.push({ code: "context_missing", sharedContextId });
      continue;
    }
    if (publication.projectId !== input.handoff.projectId) {
      violations.push({ code: "context_project_mismatch", sharedContextId });
      continue;
    }
    if (supersededContextIds.has(sharedContextId)) {
      violations.push({ code: "context_superseded", sharedContextId });
      continue;
    }
    const access = decideSharedContextAccess({
      publication,
      roleId: input.handoff.toRoleId,
      at: input.at,
    });
    if (!access.allowed) {
      violations.push({
        code:
          access.reason === "expired"
            ? "context_expired"
            : access.reason === "not_yet_published"
              ? "context_not_yet_published"
              : "context_not_readable",
        sharedContextId,
      });
      continue;
    }
    requiredDocuments.push({
      documentId: publication.documentId,
      contentHash: publication.contentHash,
      scope: { kind: "full" },
    });
  }

  if (violations.length > 0) {
    const freshnessViolations: readonly HandoffViolationCode[] = [
      "context_expired",
      "context_not_yet_published",
      "context_superseded",
    ];
    return {
      allowed: false,
      failure: violations.some((violation) => !freshnessViolations.includes(violation.code))
        ? "contract_validation_failed"
        : "required_context_missing",
      requiredDocuments: [],
      violations,
    };
  }
  return { allowed: true, requiredDocuments, violations: [] };
}
