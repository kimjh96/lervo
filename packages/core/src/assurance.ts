import type { ContextEvidence, ContextScope } from "@lervo/schemas";

type LoadedEvidence = Extract<ContextEvidence, { state: "loaded" }>;
type InjectedEvidence = Extract<ContextEvidence, { state: "injected" }>;

export const assuranceLevels = {
  discovered: "E0",
  selected: "E1",
  loaded: "E2",
  injected: "E3",
  referenced: "E4",
} as const;

export type AssuranceLevel = (typeof assuranceLevels)[keyof typeof assuranceLevels];

export interface ContextCoordinates {
  projectId: string;
  runId: string;
  sessionId: string;
  contextGeneration: number;
}

export interface RequiredContextDocument {
  documentId: string;
  contentHash: string;
  scope: ContextScope;
}

export type ContextGateFailureReason =
  | "not_selected"
  | "not_loaded"
  | "content_hash_mismatch"
  | "scope_not_covered"
  | "not_injected"
  | "stale_context_generation";

export type WriteContextDecision =
  | {
      allowed: true;
      assurance: "E3" | null;
      missing: [];
    }
  | {
      allowed: false;
      assurance: AssuranceLevel | null;
      failure: "required_context_missing";
      missing: Array<{
        documentId: string;
        reason: ContextGateFailureReason;
      }>;
    };

const assuranceRanks: Record<AssuranceLevel, number> = {
  E0: 0,
  E1: 1,
  E2: 2,
  E3: 3,
  E4: 4,
};

function coversScope(actual: ContextScope, required: ContextScope): boolean {
  if (actual.kind === "full") {
    return true;
  }
  if (required.kind === "full") {
    return false;
  }

  const actualSections = new Set(actual.sections);
  return required.sections.every((section) => actualSections.has(section));
}

function isSameContext(
  evidence: ContextEvidence,
  coordinates: ContextCoordinates,
): boolean {
  return (
    evidence.projectId === coordinates.projectId &&
    evidence.runId === coordinates.runId &&
    evidence.sessionId === coordinates.sessionId
  );
}

function isLoadedEvidence(evidence: ContextEvidence): evidence is LoadedEvidence {
  return evidence.state === "loaded";
}

function isInjectedEvidence(evidence: ContextEvidence): evidence is InjectedEvidence {
  return evidence.state === "injected";
}

function minimumAssurance(levels: readonly (AssuranceLevel | null)[]): AssuranceLevel | null {
  if (levels.length === 0 || levels.some((level) => level === null)) {
    return null;
  }

  return levels.reduce<AssuranceLevel>((minimum, level) => {
    if (level !== null && assuranceRanks[level] < assuranceRanks[minimum]) {
      return level;
    }
    return minimum;
  }, "E4");
}

export function evaluateWriteContext(input: {
  coordinates: ContextCoordinates;
  requiredDocuments: readonly RequiredContextDocument[];
  evidence: readonly ContextEvidence[];
}): WriteContextDecision {
  const relevantEvidence = input.evidence.filter((item) =>
    isSameContext(item, input.coordinates),
  );
  const missing: Array<{
    documentId: string;
    reason: ContextGateFailureReason;
  }> = [];
  const validChainLevels: Array<AssuranceLevel | null> = [];

  for (const requiredDocument of input.requiredDocuments) {
    const documentEvidence = relevantEvidence.filter(
      (item) => item.documentId === requiredDocument.documentId,
    );
    const selected = documentEvidence.find((item) => item.state === "selected");
    if (!selected) {
      validChainLevels.push(
        documentEvidence.some((item) => item.state === "discovered") ? "E0" : null,
      );
      missing.push({ documentId: requiredDocument.documentId, reason: "not_selected" });
      continue;
    }
    if (!coversScope(selected.scope, requiredDocument.scope)) {
      validChainLevels.push("E1");
      missing.push({ documentId: requiredDocument.documentId, reason: "scope_not_covered" });
      continue;
    }

    const loadedCandidates = documentEvidence.filter(isLoadedEvidence);
    const loaded = loadedCandidates.find(
      (item) => item.contentHash === requiredDocument.contentHash,
    );
    if (!loaded) {
      validChainLevels.push("E1");
      missing.push({
        documentId: requiredDocument.documentId,
        reason: loadedCandidates.length > 0 ? "content_hash_mismatch" : "not_loaded",
      });
      continue;
    }
    if (!coversScope(loaded.scope, requiredDocument.scope)) {
      validChainLevels.push("E1");
      missing.push({ documentId: requiredDocument.documentId, reason: "scope_not_covered" });
      continue;
    }

    const injectedCandidates = documentEvidence
      .filter(isInjectedEvidence)
      .filter((item) => item.contentHash === requiredDocument.contentHash);
    const injected = injectedCandidates.find(
      (item) => item.contextGeneration === input.coordinates.contextGeneration,
    );
    if (!injected) {
      validChainLevels.push("E2");
      missing.push({
        documentId: requiredDocument.documentId,
        reason:
          injectedCandidates.length > 0 ? "stale_context_generation" : "not_injected",
      });
      continue;
    }
    if (!coversScope(injected.scope, requiredDocument.scope)) {
      validChainLevels.push("E2");
      missing.push({ documentId: requiredDocument.documentId, reason: "scope_not_covered" });
      continue;
    }
    validChainLevels.push("E3");
  }

  if (missing.length > 0) {
    return {
      allowed: false,
      assurance: minimumAssurance(validChainLevels),
      failure: "required_context_missing",
      missing,
    };
  }

  return {
    allowed: true,
    assurance: input.requiredDocuments.length > 0 ? "E3" : null,
    missing: [],
  };
}
