import { createHash } from "node:crypto";

import { linkedEvidenceReconciliationV8SelectionProtocol } from "./linked-evidence-reconciliation-v8-contract.mjs";

export const providerShadowMinimalSelectionProtocolId =
  "linked-evidence-provider-shadow-minimal-sufficient-v9";

export const providerShadowMinimalSelectionProtocol = [
  linkedEvidenceReconciliationV8SelectionProtocol,
  "Select the smallest sufficient evidence set for the request.",
  "Select a document only when it directly supports a distinct required claim that no other selected document supports more directly.",
  "Exclude merely related, adjacent, historical, or broad background documents when a more direct source already supports the claim.",
  "Before returning tokens, remove each selection whose removal still leaves every required claim directly supported.",
  "Do not remove a selection when its distinct required claim would otherwise be unsupported.",
].join("\n");

export const providerShadowMinimalSelectionProtocolDigest = `sha256:${createHash("sha256").update(providerShadowMinimalSelectionProtocol).digest("hex")}`;

export const providerShadowClaimCoverageSelectionProtocolId =
  "linked-evidence-provider-shadow-claim-coverage-v11";

export const providerShadowClaimCoverageSelectionProtocol = [
  linkedEvidenceReconciliationV8SelectionProtocol,
  "Before minimizing, identify every independently required claim, authority boundary, prerequisite, and operational instruction supported by the supplied bodies.",
  "Keep at least one direct source for each independently required item; one selected source may cover multiple items only when its body directly states each item.",
  "Do not treat a newer, more operational, or cross-referencing document as a substitute for a distinct constraint stated only by another supplied body.",
  "After claim coverage is complete, remove only selections whose removal leaves every independently required item directly supported by another selected body.",
  "Exclude merely related, adjacent, historical, or broad background documents that support no independently required item.",
].join("\n");

export const providerShadowClaimCoverageSelectionProtocolDigest = `sha256:${createHash("sha256").update(providerShadowClaimCoverageSelectionProtocol).digest("hex")}`;

export const providerShadowRequestScopedClaimCoverageSelectionProtocolId =
  "linked-evidence-provider-shadow-request-scoped-claim-coverage-v14";

export const providerShadowRequestScopedClaimCoverageSelectionProtocol = [
  linkedEvidenceReconciliationV8SelectionProtocol,
  "First use only the request to identify the current task and phase; supplied bodies may support that scope but must not expand it.",
  "Before minimizing, identify every independently required claim, authority boundary, prerequisite, and operational instruction necessary to perform or decide that current task phase.",
  "A cross-reference, downstream stage, roadmap item, or general repository procedure does not create a required item unless the request requires it or the body directly states a prerequisite or authority necessary for the current phase.",
  "Keep at least one direct source for each independently required item; one selected source may cover multiple items only when its body directly states each item.",
  "Do not treat a newer, more operational, or cross-referencing document as a substitute for a distinct constraint stated only by another supplied body.",
  "After request-scoped claim coverage is complete, remove only selections whose removal leaves every independently required item directly supported by another selected body.",
  "Exclude merely related, adjacent, historical, downstream, or broad background documents that support no independently required current-phase item.",
].join("\n");

export const providerShadowRequestScopedClaimCoverageSelectionProtocolDigest = `sha256:${createHash(
  "sha256",
)
  .update(providerShadowRequestScopedClaimCoverageSelectionProtocol)
  .digest("hex")}`;

export const providerShadowRelationalCoverageSelectionProtocolId =
  "linked-evidence-provider-shadow-relational-coverage-v17";

export const providerShadowRelationalCoverageSelectionProtocol = [
  providerShadowRequestScopedClaimCoverageSelectionProtocol,
  "When the request compares, reconciles, merges, or resolves a conflict between distinct records, constraints, or authorities, treat each side of that relation as an independently required item.",
  "Keep a direct source for every distinct side until the supplied bodies explicitly establish that another selected source states the same constraint or fully subsumes it.",
  "A later approval, procedure, or operational decision does not by itself subsume the prerequisite, conflict boundary, or authority that makes the decision valid.",
].join("\n");

export const providerShadowRelationalCoverageSelectionProtocolDigest = `sha256:${createHash(
  "sha256",
)
  .update(providerShadowRelationalCoverageSelectionProtocol)
  .digest("hex")}`;

export function resolveProviderShadowSelectionProtocol(protocolId) {
  if (protocolId === "linked-evidence-reconciliation-v8-selection") {
    return linkedEvidenceReconciliationV8SelectionProtocol;
  }
  if (protocolId === providerShadowMinimalSelectionProtocolId) {
    return providerShadowMinimalSelectionProtocol;
  }
  if (protocolId === providerShadowClaimCoverageSelectionProtocolId) {
    return providerShadowClaimCoverageSelectionProtocol;
  }
  if (protocolId === providerShadowRequestScopedClaimCoverageSelectionProtocolId) {
    return providerShadowRequestScopedClaimCoverageSelectionProtocol;
  }
  if (protocolId === providerShadowRelationalCoverageSelectionProtocolId) {
    return providerShadowRelationalCoverageSelectionProtocol;
  }
  throw new TypeError("The provider-shadow selection protocol is unsupported.");
}
