import type { DocumentManifest } from "@lervo/schemas";

import type { DocumentStalenessRepositorySnapshot } from "../src/index.js";

export const HASH_A = `sha256:${"a".repeat(64)}`;
export const HASH_B = `sha256:${"b".repeat(64)}`;
export const HASH_C = `sha256:${"c".repeat(64)}`;
export const HASH_D = `sha256:${"d".repeat(64)}`;

export function userManifest(
  overrides: {
    documentId?: string;
    path?: string;
    verifiedRevision?: string;
    verifiedAt?: string;
    reviewIntervalDays?: number;
    connectedPaths?: string[];
  } = {},
): DocumentManifest {
  return {
    schemaVersion: 1,
    documentId: overrides.documentId ?? "doc_readme_000001",
    record: {
      path: overrides.path ?? "README.md",
      kind: "canonical",
      responsibleParty: { kind: "team", id: "maintainers" },
      connectedPaths: overrides.connectedPaths ?? ["src"],
      verifiedRevision: overrides.verifiedRevision ?? "snapshot:verified",
      verifiedAt: overrides.verifiedAt ?? "2026-08-01T00:00:00Z",
      reviewIntervalDays: overrides.reviewIntervalDays ?? 30,
      ownership: { mode: "user" },
    },
    contentPolicy: {
      mode: "user_managed",
      mediaType: "text/markdown; charset=utf-8",
      profileId: "project-guide.ko-KR/v1",
      locale: "ko-KR",
      audience: "human",
      metadataPlacement: "sidecar",
      historyMode: "separate_documents",
      splitStrategy: "topic_documents",
      automaticWrites: false,
      splitRecommendedAtBytes: 32768,
      oversizeReviewAtBytes: 65536,
      overflowAction: "report_split_recommended",
    },
    relations: { supersedesDocumentIds: [], relatedDocumentIds: [] },
  };
}

export function managedManifest(
  inputs: Array<{ sourceId: string; contentHash: string }> = [
    { sourceId: "policy", contentHash: HASH_A },
  ],
): DocumentManifest {
  return {
    schemaVersion: 1,
    documentId: "doc_managed_00001",
    record: {
      path: "AGENTS.md",
      kind: "canonical",
      responsibleParty: { kind: "team", id: "maintainers" },
      connectedPaths: ["src"],
      verifiedRevision: "snapshot:verified",
      verifiedAt: "2026-08-01T00:00:00Z",
      reviewIntervalDays: 30,
      ownership: {
        mode: "managed_blocks",
        outsideManagedBlocks: "preserve",
        blocks: [
          {
            blockId: "context",
            startMarker: "<!-- lervo:begin block=context schema=1 -->",
            endMarker: "<!-- lervo:end block=context -->",
            inputs,
          },
        ],
      },
    },
    contentPolicy: {
      mode: "managed_blocks",
      mediaType: "text/markdown; charset=utf-8",
      profileId: "agent-context.ko-KR/v1",
      locale: "ko-KR",
      audience: "human",
      metadataPlacement: "sidecar",
      historyMode: "separate_documents",
      splitStrategy: "topic_documents",
      writeScope: "declared_blocks_only",
      maxBlockBytes: 8192,
      overflowAction: "split_and_link",
    },
    relations: { supersedesDocumentIds: [], relatedDocumentIds: [] },
  };
}

export function generatedManifest(): DocumentManifest {
  const base = managedManifest();
  return {
    ...base,
    documentId: "doc_generated_0001",
    record: {
      ...base.record,
      path: ".lervo/generated/documents/context.md",
      kind: "generated",
      ownership: {
        mode: "lervo_generated",
        userContentAllowed: false,
        manifestPath: ".lervo/generated/manifests/doc_generated_0001.json",
        inputs: [{ sourceId: "canonical-policy", contentHash: HASH_A }],
      },
    },
    contentPolicy: {
      mode: "lervo_generated",
      mediaType: "text/markdown; charset=utf-8",
      profileId: "generated-context.ko-KR/v1",
      locale: "ko-KR",
      audience: "human",
      metadataPlacement: "sidecar",
      historyMode: "separate_documents",
      splitStrategy: "topic_documents",
      writeScope: "full_document_if_unmodified",
      maxDocumentBytes: 65536,
      maxTopLevelSections: 12,
      overflowAction: "split_and_link",
    },
  };
}

export function snapshot(
  revision: string,
  files: Record<string, string> = { "README.md": HASH_A, "src/index.ts": HASH_B },
): DocumentStalenessRepositorySnapshot {
  return { revision, files };
}
