import type { ProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  sha256,
  applyDurableKnowledgeOperations,
} from "@lervo/repository-knowledge";
import {
  assertConvergenceDelegationBindings,
  loadConvergenceDelegation,
  parseConvergenceDelegation,
  CONVERGENCE_DELEGATION_PATH,
  type ConvergenceDelegation,
} from "./delegation.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { recordConvergenceMaterialization } from "./materialization-event.js";
import { CONVERGENCE_ASSET_DISPOSITIONS_PATH } from "./asset-disposition-manifest.js";
import {
  prepareConvergenceAssetManifestPlan,
  type ConvergenceAssetManifestPlan,
} from "./delegation-asset-manifest-plan.js";

export interface ConvergenceDelegationPlan {
  schemaVersion: 1;
  planId: string;
  projectId: string;
  expectedCurrentHash: string | null;
  delegation: ConvergenceDelegation;
  desiredHash: string;
  assetManifest?: ConvergenceAssetManifestPlan;
}

/** A plan grants no authority. The supplied exact review must name an active accountable agent. */
export async function createConvergenceDelegationPlan(
  storage: ProjectStorage,
  value: unknown,
  options: { reviewedManifestBytes?: Uint8Array } = {},
): Promise<ConvergenceDelegationPlan> {
  const delegation = parseConvergenceDelegation(value);
  if (
    delegation.projectId !== storage.manifest.projectId ||
    (delegation.state === "active" && Date.parse(delegation.expiresAt) <= Date.now()) ||
    Buffer.byteLength(canonicalJson(delegation)) > 64 * 1024
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  await assertConvergenceDelegationBindings(
    storage.paths.repositoryRoot,
    storage.manifest.projectId,
    delegation,
    options.reviewedManifestBytes,
  );
  const assetManifest = prepareConvergenceAssetManifestPlan(
    storage.paths.repositoryRoot,
    delegation,
    options.reviewedManifestBytes,
  );
  const current = await loadConvergenceDelegation(storage.paths.repositoryRoot);
  const desiredHash = sha256(`${canonicalJson(delegation)}\n`);
  const body = {
    schemaVersion: 1 as const,
    projectId: storage.manifest.projectId,
    expectedCurrentHash: current?.contentHash ?? null,
    delegation,
    desiredHash,
    ...(assetManifest === null ? {} : { assetManifest }),
  };
  return { ...body, planId: `kstruct_${sha256(canonicalJson(body)).slice(7, 31)}` };
}

/** Exact plan identity plus the existing durable journal fences concurrent replacement and revocation. */
export async function applyConvergenceDelegationPlan(
  storage: ProjectStorage,
  plan: ConvergenceDelegationPlan,
): Promise<ConvergenceDelegationPlan> {
  if ((storage.writableEventSchemaVersion ?? 1) < 4)
    throw new KnowledgeConvergenceRuntimeError("knowledge_reader_transition_required");
  const current = await createConvergenceDelegationPlan(storage, plan.delegation, {
    ...(plan.assetManifest === undefined
      ? {}
      : { reviewedManifestBytes: new TextEncoder().encode(plan.assetManifest.content) }),
  });
  if (canonicalJson(current) !== canonicalJson(plan))
    throw new KnowledgeConvergenceRuntimeError("knowledge_plan_stale");
  await applyDurableKnowledgeOperations({
    repositoryRoot: storage.paths.repositoryRoot,
    projectId: plan.projectId,
    planId: plan.planId,
    operations: [
      ...(plan.assetManifest === undefined
        ? []
        : [
            {
              path: CONVERGENCE_ASSET_DISPOSITIONS_PATH,
              action:
                plan.assetManifest.expectedCurrentHash === null
                  ? ("create" as const)
                  : ("update" as const),
              ownership: "user" as const,
              mediaType: "application/json" as const,
              content: plan.assetManifest.content,
              desiredHash: plan.assetManifest.desiredHash,
              ...(plan.assetManifest.expectedCurrentHash === null
                ? {}
                : { expectedCurrentHash: plan.assetManifest.expectedCurrentHash }),
            },
          ]),
      {
        path: CONVERGENCE_DELEGATION_PATH,
        action: plan.expectedCurrentHash === null ? "create" : "update",
        ownership: "user",
        mediaType: "application/json",
        content: `${canonicalJson(plan.delegation)}\n`,
        desiredHash: plan.desiredHash,
        ...(plan.expectedCurrentHash === null
          ? {}
          : { expectedCurrentHash: plan.expectedCurrentHash }),
      },
    ],
    receipt: plan,
    recordApplied: (receipt) =>
      recordConvergenceMaterialization(storage, {
        operation: "convergence_delegation",
        planId: plan.planId,
        sourceSnapshotId: plan.planId,
        policyHash: plan.delegation.review.planHash,
        receipt,
        created: [
          ...(plan.expectedCurrentHash === null ? [CONVERGENCE_DELEGATION_PATH] : []),
          ...(plan.assetManifest?.expectedCurrentHash === null
            ? [CONVERGENCE_ASSET_DISPOSITIONS_PATH]
            : []),
        ],
        updated: [
          ...(plan.expectedCurrentHash === null ? [] : [CONVERGENCE_DELEGATION_PATH]),
          ...(plan.assetManifest !== undefined && plan.assetManifest.expectedCurrentHash !== null
            ? [CONVERGENCE_ASSET_DISPOSITIONS_PATH]
            : []),
        ],
        deleted: [],
        validation: {
          schemaVersion: 1,
          projectId: plan.projectId,
          reviewHash: plan.delegation.review.planHash,
          state: plan.delegation.state,
        },
      }),
  });
  return plan;
}
