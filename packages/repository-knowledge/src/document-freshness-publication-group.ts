import type { DocumentFreshnessPublicationGroup } from "./document-freshness-contract.js";
import { historicalDocumentMarker } from "./historical-documents.js";

const entrypointNames = new Set(["README.md", "AGENTS.md", "CLAUDE.md"]);
const canonicalRoots = [
  "docs/decisions/",
  "docs/adr/",
  "docs/specifications/",
  "docs/specs/",
  "docs/architecture/",
  "docs/product/",
  "docs/roadmap/",
];

/**
 * The publication group a finding carries: historical documents first (ADR-0464), then generated
 * publication pages, entrypoints at the root or directly inside a package or app, canonical roots
 * and layout role paths, and everything else.
 */
export function documentFreshnessPublicationGroup(input: {
  path: string;
  content: string;
  publicationRoot: string;
  archiveScopes: readonly string[];
  rolePaths: ReadonlySet<string>;
}): DocumentFreshnessPublicationGroup {
  if (historicalDocumentMarker(input) !== null) return "historical";
  if (input.path.startsWith(`${input.publicationRoot}/`)) return "generated";
  const segments = input.path.split("/");
  const name = segments.at(-1)!;
  if (
    entrypointNames.has(name) &&
    (segments.length === 1 ||
      (segments.length === 3 && (segments[0] === "packages" || segments[0] === "apps")))
  )
    return "entrypoint";
  if (input.rolePaths.has(input.path) || canonicalRoots.some((root) => input.path.startsWith(root)))
    return "canonical";
  return "other";
}
