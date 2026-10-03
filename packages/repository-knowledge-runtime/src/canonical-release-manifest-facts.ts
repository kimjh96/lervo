import { sha256 } from "@lervo/repository-knowledge";

import type { CanonicalAssessmentSource } from "./canonical-assessment-contract.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { convergenceSourceBytes } from "./source-capture.js";

interface ArchiveFile {
  path?: unknown;
  size?: unknown;
  sha256?: unknown;
}

/** Bind an archived package guide to its exact captured source instead of inferring it from a digest. */
export function canonicalReleaseManifestFacts(input: {
  repositoryRoot: string;
  sources: readonly CanonicalAssessmentSource[];
  capturedSources: readonly { path: string; contentHash: string }[];
}) {
  return input.sources.flatMap((source) => {
    if (!source.path.endsWith("/release-artifact-manifest.json") || !source.content) return [];
    let manifest: { archive?: { files?: ArchiveFile[] } };
    try {
      manifest = JSON.parse(source.content) as typeof manifest;
    } catch {
      return [];
    }
    const files = manifest?.archive?.files;
    if (!Array.isArray(files)) return [];
    const archiveReadme = files.find((item) => item?.path === "README.md");
    if (!archiveReadme) return [];
    const readmePath = `${source.path.slice(0, -"release-artifact-manifest.json".length)}README.md`;
    const capturedReadme = input.capturedSources.find((item) => item.path === readmePath);
    if (!capturedReadme) return [];
    const bytes = convergenceSourceBytes(input.repositoryRoot, readmePath);
    const contentHash = sha256(bytes);
    if (contentHash !== capturedReadme.contentHash)
      throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
    return [
      {
        path: source.path,
        contentHash: source.contentHash,
        format: "ReleaseArtifactManifest" as const,
        archivedReadme: {
          path: readmePath,
          contentHash,
          byteCount: bytes.byteLength,
          manifestContentHash: archiveReadme.sha256,
          manifestByteCount: archiveReadme.size,
          matchesManifest:
            archiveReadme.sha256 === contentHash && archiveReadme.size === bytes.byteLength,
          content: new TextDecoder("utf8", { fatal: true }).decode(bytes),
        },
      },
    ];
  });
}
