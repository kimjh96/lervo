/**
 * Lervo-managed knowledge state a convergence writer may change in addition to the delegated roots.
 * ADR-0485 adds the document layout and the move/split lineage records that every repository layout
 * plan writes as `lervo_generated` operations; without them a layout plan could neither be approved
 * nor applied. Authority inputs under `.lervo/knowledge/`, such as the delegation and the asset
 * disposition manifest, stay outside this scope.
 */
export const convergenceManagedKnowledgeRoots = [
  ".lervo/state/knowledge/current",
  ".lervo/state/knowledge/canonicalization-candidates",
  ".lervo/knowledge/document-normalizations",
  ".lervo/knowledge/instruction-bridges",
  ".lervo/knowledge/document-layout.yaml",
  ".lervo/knowledge/source-lineage",
  "docs/knowledge",
] as const;
export function convergenceManagedKnowledgePath(path: string): boolean {
  return convergenceManagedKnowledgeRoots.some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}
