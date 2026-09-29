export const convergenceManagedKnowledgeRoots = [
  ".lervo/state/knowledge/current",
  ".lervo/state/knowledge/canonicalization-candidates",
  ".lervo/knowledge/document-normalizations",
  ".lervo/knowledge/instruction-bridges",
  "docs/knowledge",
] as const;
export function convergenceManagedKnowledgePath(path: string): boolean {
  return convergenceManagedKnowledgeRoots.some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}
