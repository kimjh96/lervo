import type { KnowledgeConvergenceContinuityAttentionItemV1 } from "@lervo/application-contract";
import type { ContinuityFinding } from "@lervo/repository-knowledge-runtime";

import { continuityRemediation } from "./knowledge-continuity-remediation.js";

/** Findings another attention item already carries with its own remediation. */
const COVERED_ELSEWHERE: ReadonlySet<ContinuityFinding["code"]> = new Set([
  "lease_unverifiable",
  "lease_contended",
  "publication_failed",
  "replica_diverged",
]);

/**
 * ADR-0469: one non-blocking item per continuity finding that needs attention. Under ADR-0561 no
 * finding requires the user: `lervo_debt` is Lervo's own held continuity, shown with its age, and
 * everything else is informational because the resident retries it or the instruction names an
 * operator fix.
 */
export function continuityAttentionItems(
  findings: readonly ContinuityFinding[],
  observedAt: string | null,
): KnowledgeConvergenceContinuityAttentionItemV1[] {
  const items = new Map<string, KnowledgeConvergenceContinuityAttentionItemV1>();
  for (const finding of findings) {
    if (finding.severity === "info" || COVERED_ELSEWHERE.has(finding.code)) continue;
    const itemId = `knowledge_convergence_continuity_${finding.code}${finding.detail === null ? "" : `_${finding.detail.replace(/[^a-z0-9_]/gu, "_")}`}`;
    if (items.has(itemId)) continue;
    const debt = finding.severity === "lervo_debt";
    items.set(itemId, {
      schemaVersion: 1,
      kind: "knowledge_convergence_continuity",
      itemId,
      state: debt ? "lervo_debt" : "observed",
      findingCode: finding.code,
      ...(finding.actor === undefined ? {} : { actor: finding.actor }),
      severity: finding.severity,
      detail: finding.detail,
      observedAt,
      actionOwner:
        finding.actor === "provider admission"
          ? "agent"
          : debt || finding.code === "hook_runtime_unavailable"
            ? "host resident"
            : "user",
      requiresUserAction: false,
      blocking: false,
      instruction: continuityRemediation(finding),
    });
  }
  return [...items.values()].slice(0, 16);
}
