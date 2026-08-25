import { resolve } from "node:path";

export const lervoRelativePaths = {
  root: ".lervo",
  projectManifest: ".lervo/project.yaml",
  documents: ".lervo/documents",
  verifications: ".lervo/verifications",
  deliberations: ".lervo/deliberations",
  legacyDocumentRegistry: ".lervo/documents.yaml",
  documentMigrationMarker: ".lervo/.document-migration.lock",
  gitignore: ".lervo/.gitignore",
  generated: ".lervo/generated",
  generatedManifests: ".lervo/generated/manifests",
  generatedSemanticManifests: ".lervo/generated/semantic-manifests",
  data: ".lervo/data",
  state: ".lervo/state",
  knowledge: ".lervo/knowledge",
  knowledgePolicy: ".lervo/knowledge/policy.yaml",
  knowledgeDocumentLayout: ".lervo/knowledge/document-layout.yaml",
  knowledgeBundles: ".lervo/knowledge/bundles",
  knowledgeConcepts: ".lervo/knowledge/concepts",
  knowledgeClaims: ".lervo/knowledge/claims",
  knowledgeRelations: ".lervo/knowledge/relations",
  knowledgeReviewPolicies: ".lervo/knowledge/review-policies",
  knowledgeSourceLineage: ".lervo/knowledge/source-lineage",
  knowledgeInstructionBridges: ".lervo/knowledge/instruction-bridges",
  knowledgeState: ".lervo/state/knowledge",
  knowledgeInventory: ".lervo/state/knowledge/current/inventory.json",
  knowledgeSourceUnits: ".lervo/state/knowledge/current/source-units.json",
  knowledgeImpacts: ".lervo/state/knowledge/current/impact.json",
  knowledgeCandidates: ".lervo/state/knowledge/candidates",
  knowledgeOkfImports: ".lervo/state/knowledge/okf-imports",
  knowledgeIndexes: ".lervo/state/knowledge/indexes",
  eventDatabase: ".lervo/data/events.sqlite",
  cas: ".lervo/data/cas",
  workforce: ".lervo/data/workforce",
  searchEvaluations: ".lervo/search-evaluations",
  searchEnginePolicies: ".lervo/search-engine-policies",
  searchRolloutPolicies: ".lervo/search-rollout-policies",
  searchRolloutActionPolicies: ".lervo/search-rollout-action-policies",
  searchObservations: ".lervo/state/search",
  skillsLock: ".lervo/skills.lock",
  environmentSources: ".lervo/environment-sources",
  environmentTargets: ".lervo/environment-targets",
  environmentAdmissionPolicy: ".lervo/environment-admission.yaml",
  environmentObservations: ".lervo/state/environment",
  workstreams: ".lervo/state/workstreams",
} as const;

export const previousBrandRelativePaths = {
  root: ".roven",
} as const;

export interface LervoProjectPaths {
  repositoryRoot: string;
  lervoRoot: string;
  projectManifest: string;
  documents: string;
  verifications: string;
  deliberations: string;
  legacyDocumentRegistry: string;
  documentMigrationMarker: string;
  gitignore: string;
  generated: string;
  generatedManifests: string;
  generatedSemanticManifests: string;
  data: string;
  state: string;
  knowledge: string;
  knowledgePolicy: string;
  knowledgeDocumentLayout: string;
  knowledgeBundles: string;
  knowledgeConcepts: string;
  knowledgeClaims: string;
  knowledgeRelations: string;
  knowledgeReviewPolicies: string;
  knowledgeSourceLineage: string;
  knowledgeInstructionBridges: string;
  knowledgeState: string;
  knowledgeInventory: string;
  knowledgeSourceUnits: string;
  knowledgeImpacts: string;
  knowledgeCandidates: string;
  knowledgeOkfImports: string;
  knowledgeIndexes: string;
  eventDatabase: string;
  cas: string;
  workforce: string;
  searchEvaluations: string;
  searchEnginePolicies: string;
  searchRolloutPolicies: string;
  searchRolloutActionPolicies: string;
  searchObservations: string;
  skillsLock: string;
  environmentSources: string;
  environmentTargets: string;
  environmentAdmissionPolicy: string;
  environmentObservations: string;
  workstreams: string;
}

export function resolveProjectPaths(root: string): LervoProjectPaths {
  const repositoryRoot = resolve(root);
  return {
    repositoryRoot,
    lervoRoot: resolve(repositoryRoot, lervoRelativePaths.root),
    projectManifest: resolve(repositoryRoot, lervoRelativePaths.projectManifest),
    documents: resolve(repositoryRoot, lervoRelativePaths.documents),
    verifications: resolve(repositoryRoot, lervoRelativePaths.verifications),
    deliberations: resolve(repositoryRoot, lervoRelativePaths.deliberations),
    legacyDocumentRegistry: resolve(repositoryRoot, lervoRelativePaths.legacyDocumentRegistry),
    documentMigrationMarker: resolve(repositoryRoot, lervoRelativePaths.documentMigrationMarker),
    gitignore: resolve(repositoryRoot, lervoRelativePaths.gitignore),
    generated: resolve(repositoryRoot, lervoRelativePaths.generated),
    generatedManifests: resolve(repositoryRoot, lervoRelativePaths.generatedManifests),
    generatedSemanticManifests: resolve(
      repositoryRoot,
      lervoRelativePaths.generatedSemanticManifests,
    ),
    data: resolve(repositoryRoot, lervoRelativePaths.data),
    state: resolve(repositoryRoot, lervoRelativePaths.state),
    knowledge: resolve(repositoryRoot, lervoRelativePaths.knowledge),
    knowledgePolicy: resolve(repositoryRoot, lervoRelativePaths.knowledgePolicy),
    knowledgeDocumentLayout: resolve(repositoryRoot, lervoRelativePaths.knowledgeDocumentLayout),
    knowledgeBundles: resolve(repositoryRoot, lervoRelativePaths.knowledgeBundles),
    knowledgeConcepts: resolve(repositoryRoot, lervoRelativePaths.knowledgeConcepts),
    knowledgeClaims: resolve(repositoryRoot, lervoRelativePaths.knowledgeClaims),
    knowledgeRelations: resolve(repositoryRoot, lervoRelativePaths.knowledgeRelations),
    knowledgeReviewPolicies: resolve(repositoryRoot, lervoRelativePaths.knowledgeReviewPolicies),
    knowledgeSourceLineage: resolve(repositoryRoot, lervoRelativePaths.knowledgeSourceLineage),
    knowledgeInstructionBridges: resolve(
      repositoryRoot,
      lervoRelativePaths.knowledgeInstructionBridges,
    ),
    knowledgeState: resolve(repositoryRoot, lervoRelativePaths.knowledgeState),
    knowledgeInventory: resolve(repositoryRoot, lervoRelativePaths.knowledgeInventory),
    knowledgeSourceUnits: resolve(repositoryRoot, lervoRelativePaths.knowledgeSourceUnits),
    knowledgeImpacts: resolve(repositoryRoot, lervoRelativePaths.knowledgeImpacts),
    knowledgeCandidates: resolve(repositoryRoot, lervoRelativePaths.knowledgeCandidates),
    knowledgeOkfImports: resolve(repositoryRoot, lervoRelativePaths.knowledgeOkfImports),
    knowledgeIndexes: resolve(repositoryRoot, lervoRelativePaths.knowledgeIndexes),
    eventDatabase: resolve(repositoryRoot, lervoRelativePaths.eventDatabase),
    cas: resolve(repositoryRoot, lervoRelativePaths.cas),
    workforce: resolve(repositoryRoot, lervoRelativePaths.workforce),
    searchEvaluations: resolve(repositoryRoot, lervoRelativePaths.searchEvaluations),
    searchEnginePolicies: resolve(repositoryRoot, lervoRelativePaths.searchEnginePolicies),
    searchRolloutPolicies: resolve(repositoryRoot, lervoRelativePaths.searchRolloutPolicies),
    searchRolloutActionPolicies: resolve(
      repositoryRoot,
      lervoRelativePaths.searchRolloutActionPolicies,
    ),
    searchObservations: resolve(repositoryRoot, lervoRelativePaths.searchObservations),
    skillsLock: resolve(repositoryRoot, lervoRelativePaths.skillsLock),
    environmentSources: resolve(repositoryRoot, lervoRelativePaths.environmentSources),
    environmentTargets: resolve(repositoryRoot, lervoRelativePaths.environmentTargets),
    environmentAdmissionPolicy: resolve(
      repositoryRoot,
      lervoRelativePaths.environmentAdmissionPolicy,
    ),
    environmentObservations: resolve(repositoryRoot, lervoRelativePaths.environmentObservations),
    workstreams: resolve(repositoryRoot, lervoRelativePaths.workstreams),
  };
}
