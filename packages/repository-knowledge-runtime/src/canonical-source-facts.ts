import type { CanonicalAssessmentSource } from "./canonical-assessment-contract.js";

interface CycloneDxDocument {
  bomFormat?: unknown;
  metadata?: { component?: { "bom-ref"?: unknown } };
  components?: { "bom-ref"?: unknown }[];
  dependencies?: { ref?: unknown; dependsOn?: unknown }[];
}

/** Exact membership facts for large inventories that are easy to misread as text. */
export function canonicalSourceFacts(sources: readonly CanonicalAssessmentSource[]) {
  return sources.flatMap((source) => {
    if (!source.path.endsWith(".cdx.json") || source.content === undefined) return [];
    let document: CycloneDxDocument;
    try {
      document = JSON.parse(source.content) as CycloneDxDocument;
    } catch {
      return [];
    }
    if (
      document.bomFormat !== "CycloneDX" ||
      !Array.isArray(document.components) ||
      !Array.isArray(document.dependencies)
    )
      return [];
    const componentRefs = new Set(
      document.components
        .map((item) => (item && typeof item === "object" ? item["bom-ref"] : undefined))
        .filter((ref): ref is string => typeof ref === "string"),
    );
    const rootRef = document.metadata?.component?.["bom-ref"];
    if (typeof rootRef === "string") componentRefs.add(rootRef);
    const dependencyRefs = new Set<string>();
    const missingNodeRefs = new Set<string>();
    for (const node of document.dependencies) {
      if (!node || typeof node !== "object" || typeof node.ref !== "string") continue;
      if (!componentRefs.has(node.ref)) missingNodeRefs.add(node.ref);
      if (!Array.isArray(node.dependsOn)) continue;
      for (const ref of node.dependsOn) {
        if (typeof ref === "string") dependencyRefs.add(ref);
      }
    }
    return [
      {
        path: source.path,
        contentHash: source.contentHash,
        format: "CycloneDX" as const,
        componentCount: document.components.length,
        dependencyNodeCount: document.dependencies.length,
        referencedComponentCount: dependencyRefs.size,
        missingComponentReferences: [...dependencyRefs]
          .filter((ref) => !componentRefs.has(ref))
          .sort(),
        missingDependencyNodeReferences: [...missingNodeRefs].sort(),
      },
    ];
  });
}
