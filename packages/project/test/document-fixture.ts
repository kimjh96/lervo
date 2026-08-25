import type { DocumentManifest } from "@lervo/schemas";

export function userManifest(input: {
  documentId: string;
  path: string;
  relatedDocumentIds?: string[];
}): DocumentManifest {
  return {
    schemaVersion: 1,
    documentId: input.documentId,
    record: {
      path: input.path,
      kind: "canonical",
      responsibleParty: { kind: "team", id: "repository-maintainers" },
      connectedPaths: ["src"],
      verifiedRevision: "git:fixture",
      verifiedAt: "2026-08-19T00:00:00Z",
      reviewIntervalDays: 30,
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
    relations: {
      supersedesDocumentIds: [],
      relatedDocumentIds: input.relatedDocumentIds ?? [],
    },
  };
}

export function managedManifest(standardMarkers = true): DocumentManifest {
  const base = userManifest({ documentId: "doc_managed_0001", path: "AGENTS.md" });
  return {
    ...base,
    record: {
      ...base.record,
      ownership: {
        mode: "managed_blocks",
        outsideManagedBlocks: "preserve",
        blocks: [
          {
            blockId: "agent_context",
            startMarker: standardMarkers
              ? "<!-- lervo:begin block=agent_context schema=1 -->"
              : "<!-- arbitrary -->",
            endMarker: standardMarkers
              ? "<!-- lervo:end block=agent_context -->"
              : "<!-- /arbitrary -->",
            inputs: [
              {
                sourceId: "project-policy",
                contentHash: `sha256:${"a".repeat(64)}`,
              },
            ],
          },
        ],
      },
    },
    contentPolicy: {
      mode: "managed_blocks",
      mediaType: "text/markdown; charset=utf-8",
      profileId: "provider-entry.ko-KR/v1",
      locale: "ko-KR",
      audience: "mixed",
      metadataPlacement: "sidecar",
      historyMode: "separate_documents",
      splitStrategy: "topic_documents",
      writeScope: "declared_blocks_only",
      maxBlockBytes: 8192,
      overflowAction: "split_and_link",
    },
  };
}
