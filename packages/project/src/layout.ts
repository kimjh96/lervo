import { isAbsolute, resolve, sep } from "node:path";

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
  knowledgeStructural: ".lervo/state/knowledge/current/structural",
  knowledgeStructuralBundles: ".lervo/state/knowledge/current/structural/bundles",
  knowledgeStructuralConcepts: ".lervo/state/knowledge/current/structural/concepts",
  knowledgeStructuralManifests: ".lervo/state/knowledge/current/structural/manifests",
  knowledgeCandidates: ".lervo/state/knowledge/candidates",
  knowledgeIndexes: ".lervo/state/knowledge/indexes",
  eventDatabase: ".lervo/data/events.sqlite",
  eventContract: ".lervo/data/event-contract.json",
  cas: ".lervo/data/cas",
  workforce: ".lervo/data/workforce",
  searchRetrievalPlanBundles: ".lervo/search-retrieval-plan-bundles",
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
  knowledgeStructural: string;
  knowledgeStructuralBundles: string;
  knowledgeStructuralConcepts: string;
  knowledgeStructuralManifests: string;
  knowledgeCandidates: string;
  knowledgeIndexes: string;
  eventDatabase: string;
  eventContract: string;
  cas: string;
  workforce: string;
  searchRetrievalPlanBundles: string;
  searchObservations: string;
  skillsLock: string;
  environmentSources: string;
  environmentTargets: string;
  environmentAdmissionPolicy: string;
  environmentObservations: string;
  workstreams: string;
}

// Only fixed, normalized catalog suffixes are reused; roots and filesystem observations are not.
const nativeSuffixes = new Map<string, string>(
  Object.values(lervoRelativePaths)
    .filter(
      (value) =>
        !isAbsolute(value) &&
        !value.includes("\\") &&
        !value.includes(":") &&
        value.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    )
    .map((value) => [value, value.replaceAll("/", sep)]),
);

export function resolveProjectPaths(root: string): LervoProjectPaths {
  const repositoryRoot = resolve(root);
  const prefix = repositoryRoot.endsWith(sep) ? repositoryRoot : repositoryRoot + sep;
  const resolveChild = (relativePath: string) => {
    const suffix = nativeSuffixes.get(relativePath);
    return suffix === undefined ? resolve(repositoryRoot, relativePath) : prefix + suffix;
  };
  return {
    repositoryRoot,
    lervoRoot: resolveChild(lervoRelativePaths.root),
    projectManifest: resolveChild(lervoRelativePaths.projectManifest),
    documents: resolveChild(lervoRelativePaths.documents),
    verifications: resolveChild(lervoRelativePaths.verifications),
    deliberations: resolveChild(lervoRelativePaths.deliberations),
    legacyDocumentRegistry: resolveChild(lervoRelativePaths.legacyDocumentRegistry),
    documentMigrationMarker: resolveChild(lervoRelativePaths.documentMigrationMarker),
    gitignore: resolveChild(lervoRelativePaths.gitignore),
    generated: resolveChild(lervoRelativePaths.generated),
    generatedManifests: resolveChild(lervoRelativePaths.generatedManifests),
    generatedSemanticManifests: resolveChild(lervoRelativePaths.generatedSemanticManifests),
    data: resolveChild(lervoRelativePaths.data),
    state: resolveChild(lervoRelativePaths.state),
    knowledge: resolveChild(lervoRelativePaths.knowledge),
    knowledgePolicy: resolveChild(lervoRelativePaths.knowledgePolicy),
    knowledgeDocumentLayout: resolveChild(lervoRelativePaths.knowledgeDocumentLayout),
    knowledgeBundles: resolveChild(lervoRelativePaths.knowledgeBundles),
    knowledgeConcepts: resolveChild(lervoRelativePaths.knowledgeConcepts),
    knowledgeClaims: resolveChild(lervoRelativePaths.knowledgeClaims),
    knowledgeRelations: resolveChild(lervoRelativePaths.knowledgeRelations),
    knowledgeReviewPolicies: resolveChild(lervoRelativePaths.knowledgeReviewPolicies),
    knowledgeSourceLineage: resolveChild(lervoRelativePaths.knowledgeSourceLineage),
    knowledgeInstructionBridges: resolveChild(lervoRelativePaths.knowledgeInstructionBridges),
    knowledgeState: resolveChild(lervoRelativePaths.knowledgeState),
    knowledgeInventory: resolveChild(lervoRelativePaths.knowledgeInventory),
    knowledgeSourceUnits: resolveChild(lervoRelativePaths.knowledgeSourceUnits),
    knowledgeImpacts: resolveChild(lervoRelativePaths.knowledgeImpacts),
    knowledgeStructural: resolveChild(lervoRelativePaths.knowledgeStructural),
    knowledgeStructuralBundles: resolveChild(lervoRelativePaths.knowledgeStructuralBundles),
    knowledgeStructuralConcepts: resolveChild(lervoRelativePaths.knowledgeStructuralConcepts),
    knowledgeStructuralManifests: resolveChild(lervoRelativePaths.knowledgeStructuralManifests),
    knowledgeCandidates: resolveChild(lervoRelativePaths.knowledgeCandidates),
    knowledgeIndexes: resolveChild(lervoRelativePaths.knowledgeIndexes),
    eventDatabase: resolveChild(lervoRelativePaths.eventDatabase),
    eventContract: resolveChild(lervoRelativePaths.eventContract),
    cas: resolveChild(lervoRelativePaths.cas),
    workforce: resolveChild(lervoRelativePaths.workforce),
    searchRetrievalPlanBundles: resolveChild(lervoRelativePaths.searchRetrievalPlanBundles),
    searchObservations: resolveChild(lervoRelativePaths.searchObservations),
    skillsLock: resolveChild(lervoRelativePaths.skillsLock),
    environmentSources: resolveChild(lervoRelativePaths.environmentSources),
    environmentTargets: resolveChild(lervoRelativePaths.environmentTargets),
    environmentAdmissionPolicy: resolveChild(lervoRelativePaths.environmentAdmissionPolicy),
    environmentObservations: resolveChild(lervoRelativePaths.environmentObservations),
    workstreams: resolveChild(lervoRelativePaths.workstreams),
  };
}
