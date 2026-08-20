import { createHash } from "node:crypto";

import { readRepositoryFile } from "@lervo/context";
import { loadDocumentRegistry } from "@lervo/project";
import type { SearchSourceInput } from "@lervo/search";

import { SearchLocalError } from "./types.js";

const MAX_DOCUMENT_BYTES = 128 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function title(text: string): string | undefined {
  for (const line of text.split(/\r?\n/u)) {
    const match = /^#{1,6}\s+(.{1,500})\s*$/u.exec(line);
    if (match !== null) return match[1]!.trim();
  }
  return undefined;
}

export async function loadRegisteredDocumentCorpus(repositoryRoot: string): Promise<SearchSourceInput[]> {
  const registry = await loadDocumentRegistry(repositoryRoot);
  const entries = Object.entries(registry.documents).sort(([left], [right]) => compareText(left, right));
  let totalBytes = 0;
  const sources: SearchSourceInput[] = [];
  for (const [documentId, record] of entries) {
    let bytes: Uint8Array;
    try {
      bytes = await readRepositoryFile(repositoryRoot, record.path, MAX_DOCUMENT_BYTES);
    } catch (error) {
      throw new SearchLocalError(
        "corpus_read_failed",
        `등록 문서를 검색 corpus로 안전하게 읽지 못했습니다: ${documentId}`,
        { cause: error instanceof Error ? error : undefined },
      );
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new SearchLocalError("corpus_limit_exceeded", "등록 문서 corpus가 전체 byte 상한을 넘었습니다.");
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new SearchLocalError("corpus_read_failed", `등록 문서가 UTF-8이 아닙니다: ${documentId}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
    if (text.length === 0) {
      throw new SearchLocalError("corpus_read_failed", `등록 문서가 비어 있습니다: ${documentId}`);
    }
    const heading = title(text);
    sources.push({
      kind: "document",
      sourceId: documentId,
      path: record.path,
      contentHash: hash(bytes),
      ...(heading === undefined ? {} : { title: heading }),
      labels: [record.kind, record.responsibleParty.kind, ...record.connectedPaths],
      text,
    });
  }
  return sources;
}
