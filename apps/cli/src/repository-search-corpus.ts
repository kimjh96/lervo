import { createHash } from "node:crypto";

import { canonicalHash, type SearchSourceInput } from "@lervo/search";
import type { RepositoryKnowledgeScan } from "@lervo/repository-knowledge";

function sourceId(path: string): string {
  return `doc_${createHash("sha256").update(path).digest("hex").slice(0, 24)}`;
}

export function createRepositoryKnowledgeSearchCorpus(scan: RepositoryKnowledgeScan): {
  sources: SearchSourceInput[];
  digest: string;
  documentCount: number;
  byteCount: number;
} {
  const byPath = new Map<string, SearchSourceInput>();
  for (const source of scan.sources) {
    if (
      source.status !== "included" ||
      !source.path.endsWith(".md") ||
      typeof source.content !== "string" ||
      typeof source.contentHash !== "string"
    ) {
      continue;
    }
    const existing = byPath.get(source.path);
    if (existing !== undefined) {
      if (existing.contentHash !== source.contentHash || existing.text !== source.content) {
        throw new TypeError(`Corpus path has conflicting current bytes: ${source.path}`);
      }
      continue;
    }
    const heading = /^#{1,6}\s+(.+)$/mu.exec(source.content)?.[1]?.trim();
    byPath.set(source.path, {
      kind: "document",
      sourceId: sourceId(source.path),
      path: source.path,
      contentHash: source.contentHash,
      ...(heading === undefined ? {} : { title: heading }),
      labels: source.path.split("/"),
      text: source.content,
    });
  }
  const sources = [...byPath.values()].sort((left, right) => left.path!.localeCompare(right.path!));
  return {
    sources,
    digest: canonicalHash(
      sources.map((source) => ({ path: source.path, contentHash: source.contentHash })),
    ),
    documentCount: sources.length,
    byteCount: sources.reduce((sum, source) => sum + Buffer.byteLength(source.text), 0),
  };
}
