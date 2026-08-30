import { lervoRelativePaths } from "@lervo/project";

export const structuralProjectionLayoutVersion = 2 as const;
export const structuralBundleDirectory = lervoRelativePaths.knowledgeStructuralBundles;
export const structuralConceptDirectory = lervoRelativePaths.knowledgeStructuralConcepts;
export const structuralManifestDirectory = lervoRelativePaths.knowledgeStructuralManifests;
export const structuralManifestPath = `${structuralManifestDirectory}/current.json`;

export const legacyStructuralBundleDirectory = ".lervo/knowledge/bundles";
export const legacyStructuralConceptDirectory = ".lervo/knowledge/concepts";
export const legacyStructuralManifestDirectory = ".lervo/generated/manifests";
export const legacyStructuralManifestPath = `${legacyStructuralManifestDirectory}/current.json`;

export function isRebuildableStructuralProjectionPath(path: string): boolean {
  return path.startsWith(`${lervoRelativePaths.knowledgeStructural}/`);
}

function structuralArtifactId(path: string, directory: string, prefix: "bundle" | "concept") {
  if (!path.startsWith(`${directory}/`)) return null;
  const match = /^([a-f0-9]{2})\/((?:bundle|concept)_[a-f0-9]{24})\.yaml$/u.exec(
    path.slice(directory.length + 1),
  );
  if (match === null || !match[2]!.startsWith(`${prefix}_`)) return null;
  return match[2]!.slice(prefix.length + 1, prefix.length + 3) === match[1] ? match[2]! : null;
}

export function structuralConceptIdFromPath(path: string): string | null {
  return structuralArtifactId(path, structuralConceptDirectory, "concept");
}

export function structuralBundleIdFromPath(path: string): string | null {
  return structuralArtifactId(path, structuralBundleDirectory, "bundle");
}
