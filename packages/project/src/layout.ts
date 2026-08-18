import { resolve } from "node:path";

export const lervoRelativePaths = {
  root: ".lervo",
  projectManifest: ".lervo/project.yaml",
  documents: ".lervo/documents",
  legacyDocumentRegistry: ".lervo/documents.yaml",
  gitignore: ".lervo/.gitignore",
  generated: ".lervo/generated",
  state: ".lervo/state",
  knowledge: ".lervo/knowledge",
  eventDatabase: ".lervo/state/events.sqlite",
  cas: ".lervo/state/cas",
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
  legacyDocumentRegistry: string;
  gitignore: string;
  generated: string;
  state: string;
  knowledge: string;
  eventDatabase: string;
  cas: string;
  skillsLock: string;
}

export function resolveProjectPaths(root: string): LervoProjectPaths {
  const repositoryRoot = resolve(root);
  return {
    repositoryRoot,
    lervoRoot: resolve(repositoryRoot, lervoRelativePaths.root),
    projectManifest: resolve(repositoryRoot, lervoRelativePaths.projectManifest),
    documents: resolve(repositoryRoot, lervoRelativePaths.documents),
    legacyDocumentRegistry: resolve(repositoryRoot, lervoRelativePaths.legacyDocumentRegistry),
    gitignore: resolve(repositoryRoot, lervoRelativePaths.gitignore),
    generated: resolve(repositoryRoot, lervoRelativePaths.generated),
    state: resolve(repositoryRoot, lervoRelativePaths.state),
    knowledge: resolve(repositoryRoot, lervoRelativePaths.knowledge),
    eventDatabase: resolve(repositoryRoot, lervoRelativePaths.eventDatabase),
    cas: resolve(repositoryRoot, lervoRelativePaths.cas),
    skillsLock: resolve(repositoryRoot, lervoRelativePaths.skillsLock),
  };
}
