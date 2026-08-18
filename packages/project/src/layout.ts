import { resolve } from "node:path";

export const rovenRelativePaths = {
  root: ".roven",
  projectManifest: ".roven/project.yaml",
  documents: ".roven/documents",
  legacyDocumentRegistry: ".roven/documents.yaml",
  gitignore: ".roven/.gitignore",
  generated: ".roven/generated",
  state: ".roven/state",
  knowledge: ".roven/knowledge",
  eventDatabase: ".roven/state/events.sqlite",
  cas: ".roven/state/cas",
  skillsLock: ".roven/skills.lock",
} as const;

export interface RovenProjectPaths {
  repositoryRoot: string;
  rovenRoot: string;
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

export function resolveProjectPaths(root: string): RovenProjectPaths {
  const repositoryRoot = resolve(root);
  return {
    repositoryRoot,
    rovenRoot: resolve(repositoryRoot, rovenRelativePaths.root),
    projectManifest: resolve(repositoryRoot, rovenRelativePaths.projectManifest),
    documents: resolve(repositoryRoot, rovenRelativePaths.documents),
    legacyDocumentRegistry: resolve(repositoryRoot, rovenRelativePaths.legacyDocumentRegistry),
    gitignore: resolve(repositoryRoot, rovenRelativePaths.gitignore),
    generated: resolve(repositoryRoot, rovenRelativePaths.generated),
    state: resolve(repositoryRoot, rovenRelativePaths.state),
    knowledge: resolve(repositoryRoot, rovenRelativePaths.knowledge),
    eventDatabase: resolve(repositoryRoot, rovenRelativePaths.eventDatabase),
    cas: resolve(repositoryRoot, rovenRelativePaths.cas),
    skillsLock: resolve(repositoryRoot, rovenRelativePaths.skillsLock),
  };
}
