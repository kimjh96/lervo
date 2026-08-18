import { createHash } from "node:crypto";

import { decideSharedContextAccess } from "@roven/core";
import type { SharedContextPublication } from "@roven/schemas";

import { indexPublications } from "./collections.js";
import { readRepositoryFile } from "./filesystem.js";
import {
  type ContextInvalidation,
  type ContextSnapshotValidation,
  ContextPreparationError,
  type LoadedContext,
} from "./types.js";

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function validateContextSnapshot(input: {
  repositoryRoot: string;
  loaded: LoadedContext;
  publications: readonly SharedContextPublication[];
  at: Date;
}): Promise<ContextSnapshotValidation> {
  const invalidations: ContextInvalidation[] = [];
  const publications = indexPublications(
    input.publications.filter(
      (publication) => publication.projectId === input.loaded.plan.coordinates.projectId,
    ),
  );
  const superseded = new Set(
    input.publications
      .filter(
        (publication) =>
          publication.projectId === input.loaded.plan.coordinates.projectId,
      )
      .filter((publication) => Date.parse(publication.publishedAt) <= input.at.getTime())
      .map((publication) => publication.supersedesSharedContextId)
      .filter((id): id is string => id !== null),
  );

  for (const document of input.loaded.documents) {
    try {
      const currentContentHash = hash(
        await readRepositoryFile(input.repositoryRoot, document.path),
      );
      if (currentContentHash !== document.contentHash) {
        invalidations.push({
          documentId: document.documentId,
          reason: "content_changed",
          previousContentHash: document.contentHash,
          currentContentHash,
        });
      }
    } catch (error) {
      if (error instanceof ContextPreparationError && error.code === "document_missing") {
        invalidations.push({ documentId: document.documentId, reason: "document_missing" });
      } else if (
        error instanceof ContextPreparationError &&
        error.code === "unsafe_document_path"
      ) {
        invalidations.push({ documentId: document.documentId, reason: "document_unsafe" });
      } else {
        throw error;
      }
    }

    for (const sharedContextId of document.sharedContextIds) {
      const publication = publications.get(sharedContextId);
      if (!publication) {
        invalidations.push({
          documentId: document.documentId,
          sharedContextId,
          reason: "publication_missing",
        });
        continue;
      }
      if (superseded.has(sharedContextId)) {
        invalidations.push({
          documentId: document.documentId,
          sharedContextId,
          reason: "publication_superseded",
        });
        continue;
      }
      if (publication.documentId !== document.documentId) {
        invalidations.push({
          documentId: document.documentId,
          sharedContextId,
          reason: "publication_document_changed",
        });
        continue;
      }
      const access = decideSharedContextAccess({
        publication,
        roleId: input.loaded.plan.coordinates.roleId,
        at: input.at,
      });
      if (!access.allowed) {
        invalidations.push({
          documentId: document.documentId,
          sharedContextId,
          reason:
            access.reason === "expired"
              ? "publication_expired"
              : access.reason === "not_yet_published"
                ? "publication_not_yet_published"
                : "publication_access_revoked",
        });
        continue;
      }
      if (publication.contentHash !== document.contentHash) {
        invalidations.push({
          documentId: document.documentId,
          sharedContextId,
          reason: "publication_content_changed",
          previousContentHash: document.contentHash,
          currentContentHash: publication.contentHash,
        });
      }
    }
  }

  return invalidations.length === 0
    ? { valid: true, invalidations: [] }
    : { valid: false, invalidations };
}
