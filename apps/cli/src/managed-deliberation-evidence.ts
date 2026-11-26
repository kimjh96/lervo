import { createHash } from "node:crypto";

import { MAX_CONTEXT_SOURCE_BYTES, readRepositoryFile } from "@lervo/context";
import { queryRepositoryKnowledge } from "@lervo/repository-knowledge";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import { ManagedDeliberationError } from "./managed-deliberation-errors.js";
import { managedSearchQuery } from "./managed-search-context.js";

const maximumEvidenceDocuments = 5;

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export interface ManagedDeliberationEvidenceDocument {
  conceptId: string;
  title: string;
  sourcePath: string;
  sourceContentHash: string;
  assurance: "unreviewed" | "human_reviewed";
  freshness: "current" | "stale" | "unknown";
  content: string;
}

export interface ManagedDeliberationEvidenceBundle {
  schemaVersion: 1;
  query: string;
  sourceSnapshotId: string;
  impactReportId: string;
  bundleHash: string;
  documents: ManagedDeliberationEvidenceDocument[];
}

function bindingBytes(bundle: Omit<ManagedDeliberationEvidenceBundle, "bundleHash">): string {
  return JSON.stringify({
    schemaVersion: 1,
    query: bundle.query,
    sourceSnapshotId: bundle.sourceSnapshotId,
    impactReportId: bundle.impactReportId,
    documents: bundle.documents.map(({ conceptId, sourcePath, sourceContentHash }) => ({
      conceptId,
      sourcePath,
      sourceContentHash,
    })),
  });
}

export function assertManagedDeliberationEvidenceBundle(
  bundle: ManagedDeliberationEvidenceBundle,
): void {
  if (
    bundle.schemaVersion !== 1 ||
    bundle.documents.length === 0 ||
    bundle.documents.length > maximumEvidenceDocuments ||
    new Set(bundle.documents.map((document) => document.sourcePath)).size !==
      bundle.documents.length ||
    bundle.documents.some(
      (document) =>
        document.freshness !== "current" || digest(document.content) !== document.sourceContentHash,
    ) ||
    digest(bindingBytes(bundle)) !== bundle.bundleHash
  ) {
    throw new ManagedDeliberationError(
      "deliberation_evidence_unavailable",
      "The managed deliberation evidence bundle failed exact-hash validation.",
    );
  }
}

export async function prepareManagedDeliberationEvidence(input: {
  repositoryRoot: string;
  topic: string;
}): Promise<ManagedDeliberationEvidenceBundle> {
  const query = managedSearchQuery(input.topic, "formal deliberation repository evidence");
  const knowledge = await queryRepositoryKnowledge({
    repositoryRoot: input.repositoryRoot,
    query,
    limit: 20,
    supplementalSources: await collectLocalKnowledgeSources(input.repositoryRoot),
  });
  const selected = knowledge.hits
    .filter((hit) => hit.freshness === "current")
    .slice(0, maximumEvidenceDocuments);
  if (selected.length === 0) {
    throw new ManagedDeliberationError(
      "deliberation_evidence_unavailable",
      "Managed deliberation found no current canonical repository evidence for the topic.",
    );
  }
  const documents = await Promise.all(
    selected.map(async (hit): Promise<ManagedDeliberationEvidenceDocument> => {
      const bytes = await readRepositoryFile(
        input.repositoryRoot,
        hit.path,
        MAX_CONTEXT_SOURCE_BYTES,
      );
      if (digest(bytes) !== hit.contentHash) {
        throw new ManagedDeliberationError(
          "deliberation_evidence_unavailable",
          `Canonical evidence changed during deliberation preflight: ${hit.path}`,
        );
      }
      return {
        conceptId: hit.conceptId,
        title: hit.title,
        sourcePath: hit.path,
        sourceContentHash: hit.contentHash,
        assurance: hit.assurance,
        freshness: hit.freshness,
        content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      };
    }),
  );
  const unbound = {
    schemaVersion: 1,
    query,
    sourceSnapshotId: knowledge.sourceSnapshotId,
    impactReportId: knowledge.impactReportId,
    documents,
  } as const;
  const bundle = { ...unbound, bundleHash: digest(bindingBytes(unbound)) };
  assertManagedDeliberationEvidenceBundle(bundle);
  return bundle;
}
