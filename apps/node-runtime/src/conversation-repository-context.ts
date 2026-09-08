import { documentIdForPath, type ContextDocumentCandidate } from "@lervo/context";
import { readConversationControlMessage } from "@lervo/conversation-control";
import { prepareManagedSearchContext, productDefaultSearchEngine } from "@lervo/repository-context";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge/workstream";
import type { ConversationInboundEvent, DocumentRegistry, RoleProfile } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

function mergeCandidates(
  searched: readonly ContextDocumentCandidate[],
  required: readonly ContextDocumentCandidate[],
): ContextDocumentCandidate[] {
  const merged = new Map(searched.map((candidate) => [candidate.documentId, candidate]));
  for (const candidate of required) {
    const existing = merged.get(candidate.documentId);
    if (existing !== undefined && existing.path !== candidate.path) {
      throw new TypeError(
        `Conversation context document ${candidate.documentId} resolves to conflicting paths.`,
      );
    }
    merged.set(candidate.documentId, candidate);
  }
  return [...merged.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export async function prepareConversationRepositoryContext(input: {
  repositoryRoot: string;
  projectId: string;
  event: ConversationInboundEvent;
  runId: string;
  artifactStore: ArtifactStore;
  registry: DocumentRegistry;
  baseRole: RoleProfile;
}) {
  const [message, currentWorkstream] = await Promise.all([
    readConversationControlMessage({ artifactStore: input.artifactStore, event: input.event }),
    readCurrentWorkstreamState(input.repositoryRoot),
  ]);
  const search = await prepareManagedSearchContext({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    query: message,
    fallbackQuery: "repository conversation context",
    observedAt: new Date(),
    productDefault: productDefaultSearchEngine,
    documentRegistry: input.registry,
    runId: input.runId,
  });
  const role = structuredClone(input.baseRole);
  const documentRules: Record<string, string[]> = {};
  const requiredCandidates: ContextDocumentCandidate[] = [];
  if (currentWorkstream !== null) {
    const path = ".lervo/state/workstreams/current.json";
    const documentId = documentIdForPath(path);
    role.contextPolicy.requiredDocumentRuleIds.push("repository.workstream");
    documentRules["repository.workstream"] = [documentId];
    requiredCandidates.push({
      documentId,
      path,
      connectedPaths: [],
      source: "workstream",
      documentRole: "governance_context",
      referenceEligible: false,
    });
  }
  return {
    role,
    documentRules,
    additionalCandidates: mergeCandidates(search.additionalCandidates, requiredCandidates),
    recommendationBatches: search.recommendationBatches,
    graphRecommendations: search.graphRecommendations,
  };
}
