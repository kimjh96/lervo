import { resolve } from "node:path";

export const lervoRelativePaths = {
  root: ".lervo",
  projectManifest: ".lervo/project.yaml",
  documents: ".lervo/documents",
  verifications: ".lervo/verifications",
  legacyDocumentRegistry: ".lervo/documents.yaml",
  documentMigrationMarker: ".lervo/.document-migration.lock",
  gitignore: ".lervo/.gitignore",
  generated: ".lervo/generated",
  state: ".lervo/state",
  knowledge: ".lervo/knowledge",
  eventDatabase: ".lervo/state/events.sqlite",
  cas: ".lervo/state/cas",
  searchEvaluations: ".lervo/search-evaluations",
  searchEnginePolicies: ".lervo/search-engine-policies",
  searchObservations: ".lervo/state/search",
  skillsLock: ".lervo/skills.lock",
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
  legacyDocumentRegistry: string;
  documentMigrationMarker: string;
  gitignore: string;
  generated: string;
  state: string;
  knowledge: string;
  eventDatabase: string;
  cas: string;
  searchEvaluations: string;
  searchEnginePolicies: string;
  searchObservations: string;
  skillsLock: string;
}

export function resolveProjectPaths(root: string): LervoProjectPaths {
  const repositoryRoot = resolve(root);
  return {
    repositoryRoot,
    lervoRoot: resolve(repositoryRoot, lervoRelativePaths.root),
    projectManifest: resolve(repositoryRoot, lervoRelativePaths.projectManifest),
    documents: resolve(repositoryRoot, lervoRelativePaths.documents),
    verifications: resolve(repositoryRoot, lervoRelativePaths.verifications),
    legacyDocumentRegistry: resolve(repositoryRoot, lervoRelativePaths.legacyDocumentRegistry),
    documentMigrationMarker: resolve(repositoryRoot, lervoRelativePaths.documentMigrationMarker),
    gitignore: resolve(repositoryRoot, lervoRelativePaths.gitignore),
    generated: resolve(repositoryRoot, lervoRelativePaths.generated),
    state: resolve(repositoryRoot, lervoRelativePaths.state),
    knowledge: resolve(repositoryRoot, lervoRelativePaths.knowledge),
    eventDatabase: resolve(repositoryRoot, lervoRelativePaths.eventDatabase),
    cas: resolve(repositoryRoot, lervoRelativePaths.cas),
    searchEvaluations: resolve(repositoryRoot, lervoRelativePaths.searchEvaluations),
    searchEnginePolicies: resolve(repositoryRoot, lervoRelativePaths.searchEnginePolicies),
    searchObservations: resolve(repositoryRoot, lervoRelativePaths.searchObservations),
    skillsLock: resolve(repositoryRoot, lervoRelativePaths.skillsLock),
  };
}
