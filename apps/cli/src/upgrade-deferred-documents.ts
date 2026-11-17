import {
  createRepositoryLayoutMigrationPlan,
  type DocumentRouteDeferralReason,
  type DocumentRouteDeferralResolution,
  type RepositoryLayoutMigrationPlan,
} from "@lervo/repository-knowledge";

import type { KnowledgeStage } from "./upgrade-stage-inspection.js";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// ADR-0540: every deferral reason and resolution survives into the upgrade report.
const DEFERRAL_REASONS: readonly DocumentRouteDeferralReason[] = [
  "semantic_classification_pending",
  "semantic_classification_uncertain",
  "destination_conflict",
  "delegation_scope",
];
const DEFERRAL_RESOLUTIONS: readonly DocumentRouteDeferralResolution[] = [
  "background_classification",
  "delegation_scope",
  "route_metadata",
  "provider_unavailable",
  "destination_conflict",
];

function deferredDocuments(value: unknown): NonNullable<KnowledgeStage["deferredDocuments"]> {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const document = record(item);
        return document !== null &&
          typeof document.path === "string" &&
          DEFERRAL_REASONS.includes(document.reason as DocumentRouteDeferralReason) &&
          (document.subject === "document" ||
            document.subject === "decision" ||
            document.subject === "instruction")
          ? [
              {
                path: document.path,
                reason: document.reason as DocumentRouteDeferralReason,
                subject: document.subject,
                resolution: (DEFERRAL_RESOLUTIONS.includes(
                  document.resolution as DocumentRouteDeferralResolution,
                )
                  ? document.resolution
                  : "background_classification") as DocumentRouteDeferralResolution,
              },
            ]
          : [];
      })
    : [];
}

/**
 * The layout plan's deferrals; an unavailable layout reports none rather than failing the stage.
 * ADR-0578: a layout the migration run already planned is not planned again.
 */
export async function layoutDeferrals(
  root: string,
  value: Record<string, unknown> | null,
  planned: RepositoryLayoutMigrationPlan | null,
): Promise<NonNullable<KnowledgeStage["deferredDocuments"]>> {
  if (Array.isArray(value?.deferredDocuments)) return deferredDocuments(value.deferredDocuments);
  if (planned !== null) return deferredDocuments(planned.deferredDocuments);
  return createRepositoryLayoutMigrationPlan({ repositoryRoot: root }).then(
    (plan) => deferredDocuments(plan.deferredDocuments),
    () => [],
  );
}
