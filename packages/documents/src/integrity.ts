import type {
  DocumentMigrationCandidate,
  DocumentMigrationPlan,
} from "@roven/schemas";

import { canonicalJsonBytes, sha256 } from "./hash.js";

export function migrationCandidateBytes(
  candidate: DocumentMigrationCandidate,
): Uint8Array {
  return canonicalJsonBytes(candidate);
}

export function calculateMigrationPlanId(
  plan: Omit<DocumentMigrationPlan, "planId" | "generatedAt"> | DocumentMigrationPlan,
): string {
  const value = plan as Partial<DocumentMigrationPlan> & Record<string, unknown>;
  const { planId: _planId, generatedAt: _generatedAt, ...content } = value;
  const digest = sha256(canonicalJsonBytes(content));
  return `migp_${digest.slice("sha256:".length, "sha256:".length + 16)}`;
}
