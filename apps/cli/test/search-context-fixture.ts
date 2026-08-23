import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { serializeYaml } from "@lervo/project";
import type { DocumentManifest } from "@lervo/schemas";

export async function registerSearchContextDocument(root: string): Promise<void> {
  const manifest: DocumentManifest = {
    schemaVersion: 1,
    documentId: "doc_cli_search_context",
    record: {
      path: "docs/search-context.md",
      kind: "canonical",
      responsibleParty: { kind: "team", id: "platform" },
      connectedPaths: ["unrelated/**"],
      verifiedRevision: "fixture-search-v1",
      verifiedAt: "2026-08-19T00:00:00Z",
      reviewIntervalDays: 30,
      ownership: { mode: "user" },
    },
    contentPolicy: {
      mode: "user_managed",
      mediaType: "text/markdown; charset=utf-8",
      profileId: "search/context",
      locale: "en",
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
  await mkdir(resolve(root, "docs"), { recursive: true });
  await mkdir(resolve(root, ".lervo/documents"));
  await writeFile(
    resolve(root, "docs/search-context.md"),
    "# Tiny-artifact implementation guide\n\nUse zephyrcontext when implementing tinyartifact.\n",
  );
  await writeFile(
    resolve(root, ".lervo/documents/doc_cli_search_context.yaml"),
    serializeYaml(manifest),
  );
}
