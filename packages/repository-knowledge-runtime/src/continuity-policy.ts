import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

import { safeConvergenceSourcePath as safeRoot } from "./convergence-source-path.js";
import type { ConvergenceDelegation, ConvergenceWorkerRole } from "./delegation-contract.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/**
 * ADR-0469 host continuity policy. The owner installs it once per host; it lets every knowledge
 * resident on that host renew its delegation at the same scope and seed a missing delegation from
 * a peer host or the policy template, without the owner in the loop. It never widens a scope:
 * anything outside its limits remains an owner review.
 */
export const CONVERGENCE_CONTINUITY_POLICY_FILE = "knowledge-continuity-policy.json";

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 60 * 60_000;
export const MAXIMUM_CONTINUITY_HORIZON_MS = 366 * DAY_MS;
const ROLE_ID = /^[a-z][a-z0-9-]{0,63}$/u;
const POLICY_ID = /^kcpol_[a-f0-9]{24}$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const WORKER_ROLES = ["generator", "reviewer", "writer", "integrator"] as const;

type Provider = "codex" | "claude";
type ResourceCeilings = ConvergenceDelegation["resourceCeilings"];

/** The default scope a seeded repository receives when no peer host holds a delegation. */
export interface ConvergenceDelegationTemplate {
  parentRoleId: string;
  roleIds: Record<ConvergenceWorkerRole, string>;
  canonicalRoots: string[];
  normalizationRoots: string[];
  providers: Provider[];
  integrationRef: string;
  resourceCeilings: ResourceCeilings;
  /** The repository's own latest `repository.default.vN` (or `repository.default`) suite. */
  verificationSuite: "repository_default";
}

export interface ConvergenceContinuityPolicyBody {
  schemaVersion: 1;
  policyId: string;
  state: "active" | "revoked";
  /**
   * `owner_installed`: installed through the reviewed plan/apply command. `owner_instruction`:
   * adopted from the owner's recorded standing instruction (ADR-0469) on a host where the owner
   * had already reviewed at least one delegation.
   */
  authority: { kind: "owner_installed" | "owner_instruction"; reference: string | null };
  issuedAt: string;
  /** No continued delegation may expire after this instant. */
  horizonAt: string;
  renewal: { termDays: number; windowHours: number; attentionLeadHours: number };
  seeding: { fromPeer: boolean; fromTemplate: boolean };
  limits: { providers: Provider[]; resourceCeilings: ResourceCeilings };
  template: ConvergenceDelegationTemplate | null;
}

export interface ConvergenceContinuityPolicy extends ConvergenceContinuityPolicyBody {
  policyHash: string;
}

export const DEFAULT_CONTINUITY_RENEWAL = {
  termDays: 30,
  windowHours: 48,
  attentionLeadHours: 72,
} as const;
export const DEFAULT_CONTINUITY_HORIZON_DAYS = 365;

export function convergenceContinuityPolicyHash(body: ConvergenceContinuityPolicyBody): string {
  return sha256(canonicalJson(body));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function integer(value: unknown, minimum: number, maximum: number): boolean {
  return (
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  );
}

function providers(value: unknown): value is Provider[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 2 &&
    new Set(value).size === value.length &&
    value.every((provider) => provider === "codex" || provider === "claude")
  );
}

function ceilings(value: unknown): value is ResourceCeilings {
  return (
    exactKeys(value, [
      "maximumStages",
      "maximumDocuments",
      "maximumSourceBytes",
      "maximumProviderCalls",
    ]) &&
    integer(value.maximumStages, 1, 8) &&
    integer(value.maximumDocuments, 1, 8) &&
    integer(value.maximumSourceBytes, 1, 1_048_576) &&
    integer(value.maximumProviderCalls, 1, 8)
  );
}

function roots(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 32 &&
    new Set(value).size === value.length &&
    value.every((root) => typeof root === "string" && safeRoot(root))
  );
}

function validTemplate(value: unknown): value is ConvergenceDelegationTemplate {
  return (
    exactKeys(value, [
      "parentRoleId",
      "roleIds",
      "canonicalRoots",
      "normalizationRoots",
      "providers",
      "integrationRef",
      "resourceCeilings",
      "verificationSuite",
    ]) &&
    typeof value.parentRoleId === "string" &&
    ROLE_ID.test(value.parentRoleId) &&
    exactKeys(value.roleIds, WORKER_ROLES) &&
    WORKER_ROLES.every((role) => {
      const roleId = (value.roleIds as Record<string, unknown>)[role];
      return typeof roleId === "string" && ROLE_ID.test(roleId);
    }) &&
    roots(value.canonicalRoots) &&
    roots(value.normalizationRoots) &&
    providers(value.providers) &&
    typeof value.integrationRef === "string" &&
    /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u.test(value.integrationRef) &&
    !value.integrationRef.includes("..") &&
    ceilings(value.resourceCeilings) &&
    value.verificationSuite === "repository_default"
  );
}

/** Exact-key validation plus the hash; any deviation is `convergence_continuity_policy_invalid`. */
export function parseConvergenceContinuityPolicy(value: unknown): ConvergenceContinuityPolicy {
  if (
    !exactKeys(value, [
      "schemaVersion",
      "policyId",
      "state",
      "authority",
      "issuedAt",
      "horizonAt",
      "renewal",
      "seeding",
      "limits",
      "template",
      "policyHash",
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.policyId !== "string" ||
    !POLICY_ID.test(value.policyId) ||
    (value.state !== "active" && value.state !== "revoked") ||
    !exactKeys(value.authority, ["kind", "reference"]) ||
    (value.authority.kind !== "owner_installed" && value.authority.kind !== "owner_instruction") ||
    !(
      value.authority.reference === null ||
      (typeof value.authority.reference === "string" &&
        /^[A-Za-z0-9._:-]{1,64}$/u.test(value.authority.reference))
    ) ||
    typeof value.issuedAt !== "string" ||
    typeof value.horizonAt !== "string" ||
    !Number.isFinite(Date.parse(value.issuedAt)) ||
    !Number.isFinite(Date.parse(value.horizonAt)) ||
    Date.parse(value.horizonAt) <= Date.parse(value.issuedAt) ||
    Date.parse(value.horizonAt) - Date.parse(value.issuedAt) > MAXIMUM_CONTINUITY_HORIZON_MS ||
    !exactKeys(value.renewal, ["termDays", "windowHours", "attentionLeadHours"]) ||
    !integer(value.renewal.termDays, 1, 90) ||
    !integer(value.renewal.windowHours, 1, 168) ||
    !integer(value.renewal.attentionLeadHours, 24, 336) ||
    (value.renewal.attentionLeadHours as number) < (value.renewal.windowHours as number) ||
    (value.renewal.windowHours as number) * HOUR_MS >=
      (value.renewal.termDays as number) * DAY_MS ||
    !exactKeys(value.seeding, ["fromPeer", "fromTemplate"]) ||
    typeof value.seeding.fromPeer !== "boolean" ||
    typeof value.seeding.fromTemplate !== "boolean" ||
    !exactKeys(value.limits, ["providers", "resourceCeilings"]) ||
    !providers(value.limits.providers) ||
    !ceilings(value.limits.resourceCeilings) ||
    !(value.template === null || validTemplate(value.template)) ||
    (value.seeding.fromTemplate === true && value.template === null) ||
    typeof value.policyHash !== "string" ||
    !HASH.test(value.policyHash)
  )
    throw new KnowledgeConvergenceRuntimeError("convergence_continuity_policy_invalid");
  const { policyHash, ...body } = value as unknown as ConvergenceContinuityPolicy;
  if (convergenceContinuityPolicyHash(body) !== policyHash)
    throw new KnowledgeConvergenceRuntimeError("convergence_continuity_policy_invalid");
  return structuredClone(value as unknown as ConvergenceContinuityPolicy);
}

/** Seals a policy body: derives its identity from the content and attaches the hash. */
export function sealConvergenceContinuityPolicy(
  body: Omit<ConvergenceContinuityPolicyBody, "policyId">,
): ConvergenceContinuityPolicy {
  const identified: ConvergenceContinuityPolicyBody = {
    ...body,
    policyId: `kcpol_${sha256(canonicalJson(body)).slice(7, 31)}`,
  };
  return parseConvergenceContinuityPolicy({
    ...identified,
    policyHash: convergenceContinuityPolicyHash(identified),
  });
}

/** The scope limits and template a delegation implies; it never exceeds that delegation. */
export function continuityPolicyFromDelegation(input: {
  delegation: ConvergenceDelegation;
  parentRoleId: string;
  authority: ConvergenceContinuityPolicyBody["authority"];
  now: Date;
  renewal?: ConvergenceContinuityPolicyBody["renewal"];
  horizonDays?: number;
  seeding?: ConvergenceContinuityPolicyBody["seeding"];
}): ConvergenceContinuityPolicy {
  const { delegation } = input;
  const horizonDays = input.horizonDays ?? DEFAULT_CONTINUITY_HORIZON_DAYS;
  return sealConvergenceContinuityPolicy({
    schemaVersion: 1,
    state: "active",
    authority: input.authority,
    issuedAt: input.now.toISOString(),
    horizonAt: new Date(input.now.getTime() + horizonDays * DAY_MS).toISOString(),
    renewal: input.renewal ?? { ...DEFAULT_CONTINUITY_RENEWAL },
    seeding: input.seeding ?? { fromPeer: true, fromTemplate: true },
    limits: {
      providers: [...delegation.providers],
      resourceCeilings: { ...delegation.resourceCeilings },
    },
    template: {
      parentRoleId: input.parentRoleId,
      roleIds: {
        generator: delegation.roles.generator.roleId,
        reviewer: delegation.roles.reviewer.roleId,
        writer: delegation.roles.writer.roleId,
        integrator: delegation.roles.integrator.roleId,
      },
      canonicalRoots: [...delegation.canonicalRoots],
      normalizationRoots: [...delegation.normalizationRoots],
      providers: [...delegation.providers],
      integrationRef: delegation.integrationTarget.ref,
      resourceCeilings: { ...delegation.resourceCeilings },
      verificationSuite: "repository_default",
    },
  });
}

/** Whether a delegation's providers and ceilings fit inside the policy limits. */
export function delegationWithinContinuityLimits(
  delegation: Pick<ConvergenceDelegation, "providers" | "resourceCeilings">,
  policy: Pick<ConvergenceContinuityPolicy, "limits">,
): "within" | "provider_outside_policy" | "ceiling_outside_policy" {
  if (!delegation.providers.every((provider) => policy.limits.providers.includes(provider)))
    return "provider_outside_policy";
  const limit = policy.limits.resourceCeilings;
  const own = delegation.resourceCeilings;
  return own.maximumStages <= limit.maximumStages &&
    own.maximumDocuments <= limit.maximumDocuments &&
    own.maximumSourceBytes <= limit.maximumSourceBytes &&
    own.maximumProviderCalls <= limit.maximumProviderCalls
    ? "within"
    : "ceiling_outside_policy";
}
