import { createHash } from "node:crypto";

import { validateSchema, type SkillManifest } from "@lervo/schemas";

export interface SkillAuthorizationPlan {
  schemaVersion: 1;
  planKind: "project_skill_authorization";
  planId: string;
  repositoryRoot: string;
  projectId: string;
  skillId: string;
  version: string;
  contentHash: string;
  manifestPath: string;
  expectedManifestHash: string;
  desiredManifestHash: string;
  reviewerId: string;
  reviewedAt: string;
  trustTransition: { from: "untrusted"; to: "reviewed" };
  scopeTransition: { from: "disabled"; to: "project"; projectId: string };
  desiredManifest: SkillManifest;
  status: "ready";
}

export type SkillAuthorizationErrorCode =
  | "skill_authorization_invalid"
  | "skill_authorization_not_candidate"
  | "skill_authorization_stale"
  | "skill_authorization_write_failed";

export class SkillAuthorizationError extends Error {
  constructor(
    readonly code: SkillAuthorizationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SkillAuthorizationError";
  }
}

export function hashSkillAuthorizationValue(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stablePlanId(value: Omit<SkillAuthorizationPlan, "planId" | "status">): string {
  return `skauth_${createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 24)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function validTimestamp(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

export function createSkillAuthorizationPlanValue(input: {
  repositoryRoot: string;
  projectId: string;
  manifestPath: string;
  expectedManifestHash: string;
  manifest: SkillManifest;
  reviewerId: string;
  reviewedAt: string;
}): SkillAuthorizationPlan {
  if (
    !validateSchema("skill", input.manifest).valid ||
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(input.projectId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/u.test(input.reviewerId) ||
    !validTimestamp(input.reviewedAt) ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.expectedManifestHash) ||
    !/^\.agents\/skills\/[a-z][a-z0-9-]*\/lervo-skill\.json$/u.test(input.manifestPath)
  )
    throw new SkillAuthorizationError(
      "skill_authorization_invalid",
      "The project skill authorization coordinates are invalid.",
    );
  if (
    input.manifest.source.kind !== "project" ||
    input.manifest.source.publisher.id !== "lervo.development-pattern" ||
    input.manifest.trust.level !== "untrusted" ||
    input.manifest.enabledScope.kind !== "disabled"
  )
    throw new SkillAuthorizationError(
      "skill_authorization_not_candidate",
      "Only an untrusted and disabled development-pattern skill may enter project authorization.",
    );
  const desiredManifest: SkillManifest = {
    ...structuredClone(input.manifest),
    trust: {
      level: "reviewed",
      signatureStatus: input.manifest.trust.signatureStatus,
      reviewedBy: input.reviewerId,
      reviewedAt: input.reviewedAt,
    },
    enabledScope: { kind: "projects", projectIds: [input.projectId] },
  };
  if (!validateSchema("skill", desiredManifest).valid)
    throw new SkillAuthorizationError(
      "skill_authorization_invalid",
      "The reviewed project skill manifest is invalid.",
    );
  const desiredManifestHash = hashSkillAuthorizationValue(
    `${JSON.stringify(desiredManifest, null, 2)}\n`,
  );
  const body = {
    schemaVersion: 1 as const,
    planKind: "project_skill_authorization" as const,
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    skillId: input.manifest.skillId,
    version: input.manifest.version,
    contentHash: input.manifest.contentHash,
    manifestPath: input.manifestPath,
    expectedManifestHash: input.expectedManifestHash,
    desiredManifestHash,
    reviewerId: input.reviewerId,
    reviewedAt: input.reviewedAt,
    trustTransition: { from: "untrusted" as const, to: "reviewed" as const },
    scopeTransition: {
      from: "disabled" as const,
      to: "project" as const,
      projectId: input.projectId,
    },
    desiredManifest,
  };
  return { ...body, planId: stablePlanId(body), status: "ready" };
}

export function parseSkillAuthorizationPlan(value: unknown): SkillAuthorizationPlan {
  const plan = value as Partial<SkillAuthorizationPlan> | null;
  if (
    plan === null ||
    typeof plan !== "object" ||
    plan.schemaVersion !== 1 ||
    plan.planKind !== "project_skill_authorization" ||
    plan.status !== "ready" ||
    typeof plan.planId !== "string" ||
    typeof plan.repositoryRoot !== "string" ||
    typeof plan.projectId !== "string" ||
    typeof plan.manifestPath !== "string" ||
    typeof plan.expectedManifestHash !== "string" ||
    typeof plan.reviewerId !== "string" ||
    typeof plan.reviewedAt !== "string" ||
    !validateSchema("skill", plan.desiredManifest).valid ||
    (plan.desiredManifest as SkillManifest).trust.level !== "reviewed" ||
    (plan.desiredManifest as SkillManifest).enabledScope.kind !== "projects"
  )
    throw new SkillAuthorizationError(
      "skill_authorization_invalid",
      "The project skill authorization plan is invalid.",
    );
  const desiredManifest = plan.desiredManifest as SkillManifest;
  const signatureStatus = desiredManifest.trust.signatureStatus;
  if (signatureStatus === "valid")
    throw new SkillAuthorizationError(
      "skill_authorization_invalid",
      "An unsigned development-pattern candidate cannot acquire a valid signature by review.",
    );
  const rebuilt = createSkillAuthorizationPlanValue({
    repositoryRoot: plan.repositoryRoot,
    projectId: plan.projectId,
    manifestPath: plan.manifestPath,
    expectedManifestHash: plan.expectedManifestHash,
    manifest: {
      ...desiredManifest,
      trust: { level: "untrusted", signatureStatus },
      enabledScope: { kind: "disabled" },
    },
    reviewerId: plan.reviewerId,
    reviewedAt: plan.reviewedAt,
  });
  if (canonicalJson(rebuilt) !== canonicalJson(plan))
    throw new SkillAuthorizationError(
      "skill_authorization_invalid",
      "The project skill authorization plan binding is invalid.",
    );
  return structuredClone(rebuilt);
}
