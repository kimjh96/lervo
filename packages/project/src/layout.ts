import { resolve } from "node:path";

export const rovenRelativePaths = {
  root: ".roven",
  projectManifest: ".roven/project.yaml",
  documentRegistry: ".roven/documents.yaml",
  gitignore: ".roven/.gitignore",
  generated: ".roven/generated",
  state: ".roven/state",
  knowledge: ".roven/knowledge",
  eventDatabase: ".roven/state/events.sqlite",
  cas: ".roven/state/cas",
} as const;

export interface RovenProjectPaths {
  repositoryRoot: string;
  rovenRoot: string;
  projectManifest: string;
  documentRegistry: string;
  gitignore: string;
  generated: string;
  state: string;
  knowledge: string;
  eventDatabase: string;
  cas: string;
}

export function resolveProjectPaths(root: string): RovenProjectPaths {
  const repositoryRoot = resolve(root);
  return {
    repositoryRoot,
    rovenRoot: resolve(repositoryRoot, rovenRelativePaths.root),
    projectManifest: resolve(repositoryRoot, rovenRelativePaths.projectManifest),
    documentRegistry: resolve(repositoryRoot, rovenRelativePaths.documentRegistry),
    gitignore: resolve(repositoryRoot, rovenRelativePaths.gitignore),
    generated: resolve(repositoryRoot, rovenRelativePaths.generated),
    state: resolve(repositoryRoot, rovenRelativePaths.state),
    knowledge: resolve(repositoryRoot, rovenRelativePaths.knowledge),
    eventDatabase: resolve(repositoryRoot, rovenRelativePaths.eventDatabase),
    cas: resolve(repositoryRoot, rovenRelativePaths.cas),
  };
}
