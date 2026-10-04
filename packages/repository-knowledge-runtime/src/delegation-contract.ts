import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import {
  parseConvergenceSourceCapturePolicy,
  type ConvergenceSourceCapturePolicy,
} from "./source-capture-contract.js";

import { safeConvergenceSourcePath as safeRoot } from "./convergence-source-path.js";
import {
  parseConvergenceAssetDispositions,
  type ConvergenceAssetDisposition,
} from "./asset-disposition-contract.js";

export const CONVERGENCE_DELEGATION_PATH = ".lervo/knowledge/convergence-delegation.json";
export type ConvergenceWorkerRole = "generator" | "reviewer" | "writer" | "integrator";

export interface ConvergenceRoleBinding {
  roleId: string;
  version: string;
  contractHash: string;
  profileHash: string;
  capabilityHash: string;
}

export interface ConvergenceDelegation {
  schemaVersion: 1;
  projectId: string;
  state: "active" | "revoked";
  parentAgentId: string;
  parentRoleHash: string;
  roles: Record<ConvergenceWorkerRole, ConvergenceRoleBinding>;
  canonicalRoots: string[];
  normalizationRoots: string[];
  providers: ("codex" | "claude")[];
  verification: { suiteId: string; suiteHash: string }[];
  integrationTarget: { ref: string; repositoryIdentityHash: string };
  expiresAt: string;
  resourceCeilings: {
    maximumStages: number;
    maximumDocuments: number;
    maximumSourceBytes: number;
    maximumProviderCalls: number;
  };
  sourceCapture?: ConvergenceSourceCapturePolicy;
  assetDispositions?: ConvergenceAssetDisposition[];
  assetDispositionManifestHash?: string;
  review: { reviewerAgentId: string; reviewedAt: string; planHash: string };
}

const HASH = /^sha256:[a-f0-9]{64}$/u;
const AGENT = /^agt_[a-f0-9]{24}$/u;

export function convergenceDelegationPlanHash(
  value: Omit<ConvergenceDelegation, "review">,
): string {
  return sha256(canonicalJson(value));
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join() === [...keys].sort().join()
  );
}

export function parseConvergenceDelegation(value: unknown): ConvergenceDelegation {
  const delegation = value as Partial<ConvergenceDelegation> | null;
  if (
    delegation === null ||
    typeof delegation !== "object" ||
    !exactKeys(delegation, [
      ...(delegation.assetDispositions === undefined ? [] : ["assetDispositions"]),
      ...(delegation.assetDispositionManifestHash === undefined
        ? []
        : ["assetDispositionManifestHash"]),
      ...(delegation.sourceCapture === undefined ? [] : ["sourceCapture"]),
      "schemaVersion",
      "projectId",
      "state",
      "parentAgentId",
      "parentRoleHash",
      "roles",
      "canonicalRoots",
      "normalizationRoots",
      "providers",
      "verification",
      "integrationTarget",
      "expiresAt",
      "resourceCeilings",
      "review",
    ]) ||
    !exactKeys(delegation.roles, ["generator", "reviewer", "writer", "integrator"]) ||
    !exactKeys(delegation.review, ["reviewerAgentId", "reviewedAt", "planHash"]) ||
    !exactKeys(delegation.integrationTarget, ["ref", "repositoryIdentityHash"]) ||
    !exactKeys(delegation.resourceCeilings, [
      "maximumStages",
      "maximumDocuments",
      "maximumSourceBytes",
      "maximumProviderCalls",
    ]) ||
    delegation.schemaVersion !== 1 ||
    !/^prj_[A-Za-z0-9_-]{8,128}$/u.test(delegation.projectId ?? "") ||
    !["active", "revoked"].includes(delegation.state ?? "") ||
    !AGENT.test(delegation.parentAgentId ?? "") ||
    !HASH.test(delegation.parentRoleHash ?? "") ||
    !Array.isArray(delegation.canonicalRoots) ||
    !delegation.canonicalRoots.length ||
    delegation.canonicalRoots.length > 32 ||
    !delegation.canonicalRoots.every(safeRoot) ||
    new Set(delegation.canonicalRoots).size !== delegation.canonicalRoots.length ||
    !Array.isArray(delegation.normalizationRoots) ||
    !delegation.normalizationRoots.length ||
    delegation.normalizationRoots.length > 32 ||
    !delegation.normalizationRoots.every(safeRoot) ||
    new Set(delegation.normalizationRoots).size !== delegation.normalizationRoots.length ||
    !Array.isArray(delegation.providers) ||
    delegation.providers.length < 1 ||
    delegation.providers.length > 2 ||
    new Set(delegation.providers).size !== delegation.providers.length ||
    !delegation.providers.every((provider) => provider === "codex" || provider === "claude") ||
    !Array.isArray(delegation.verification) ||
    delegation.verification.length < 1 ||
    delegation.verification.length > 16 ||
    !delegation.verification.every(
      (suite) =>
        exactKeys(suite, ["suiteId", "suiteHash"]) &&
        typeof suite?.suiteId === "string" &&
        HASH.test(suite.suiteHash),
    ) ||
    !/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/u.test(
      delegation.integrationTarget?.ref ?? "",
    ) ||
    delegation.integrationTarget?.ref.includes("..") ||
    !HASH.test(delegation.integrationTarget?.repositoryIdentityHash ?? "") ||
    !Number.isFinite(Date.parse(delegation.expiresAt ?? "")) ||
    !AGENT.test(delegation.review?.reviewerAgentId ?? "") ||
    !Number.isFinite(Date.parse(delegation.review?.reviewedAt ?? "")) ||
    !HASH.test(delegation.review?.planHash ?? "") ||
    delegation.roles === undefined ||
    !["generator", "reviewer", "writer", "integrator"].every((role) => {
      const binding = delegation.roles?.[role as ConvergenceWorkerRole];
      return (
        exactKeys(binding, [
          "roleId",
          "version",
          "contractHash",
          "profileHash",
          "capabilityHash",
        ]) &&
        typeof binding?.roleId === "string" &&
        typeof binding.version === "string" &&
        HASH.test(binding.contractHash) &&
        HASH.test(binding.profileHash) &&
        HASH.test(binding.capabilityHash)
      );
    })
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const ceilings = delegation.resourceCeilings;
  if (
    ceilings === undefined ||
    ![
      ceilings.maximumStages,
      ceilings.maximumDocuments,
      ceilings.maximumSourceBytes,
      ceilings.maximumProviderCalls,
    ].every((count) => Number.isSafeInteger(count) && count > 0) ||
    ceilings.maximumStages > 8 ||
    ceilings.maximumDocuments > 8 ||
    ceilings.maximumSourceBytes > 1_048_576 ||
    ceilings.maximumProviderCalls > 8
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  if (delegation.assetDispositions !== undefined)
    parseConvergenceAssetDispositions(
      delegation.assetDispositions,
      delegation.verification.map((suite) => suite.suiteId),
      256,
    );
  if (
    delegation.assetDispositionManifestHash !== undefined &&
    !HASH.test(delegation.assetDispositionManifestHash)
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const { review, ...plan } = delegation as ConvergenceDelegation;
  if (delegation.sourceCapture !== undefined)
    parseConvergenceSourceCapturePolicy(delegation.sourceCapture);
  if (review.planHash !== convergenceDelegationPlanHash(plan))
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  return structuredClone(delegation as ConvergenceDelegation);
}

export function pathWithinConvergenceRoots(path: string, roots: readonly string[]): boolean {
  return safeRoot(path) && roots.some((root) => path === root || path.startsWith(`${root}/`));
}
