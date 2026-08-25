import type { DocumentRegistry } from "@lervo/schemas";

import { repositoryFileExists } from "./filesystem.js";
import { compareCanonicalText, documentIdForPath, instructionPathsFor } from "./paths.js";
import { type ContextDocumentCandidate, ContextPreparationError } from "./types.js";

function registryCandidates(registry: DocumentRegistry): Map<string, ContextDocumentCandidate> {
  const candidates = new Map<string, ContextDocumentCandidate>();
  for (const [documentId, document] of Object.entries(registry.documents)) {
    const existing = candidates.get(document.path);
    if (existing) {
      throw new ContextPreparationError(
        "duplicate_document_path",
        `${document.path} is registered more than once for ${existing.documentId} and ${documentId}.`,
      );
    }
    candidates.set(document.path, {
      documentId,
      path: document.path,
      connectedPaths: document.connectedPaths,
      source: "registry" as const,
    });
  }
  return candidates;
}

export function candidatesFromRegistry(registry: DocumentRegistry): ContextDocumentCandidate[] {
  return [...registryCandidates(registry).values()].sort((left, right) =>
    compareCanonicalText(left.path, right.path),
  );
}

export async function discoverInstructionDocuments(input: {
  repositoryRoot: string;
  registry: DocumentRegistry;
  expectedPaths: readonly string[];
}): Promise<ContextDocumentCandidate[]> {
  const candidates = registryCandidates(input.registry);
  const discovered: ContextDocumentCandidate[] = [];
  for (const path of instructionPathsFor(input.expectedPaths)) {
    if (!(await repositoryFileExists(input.repositoryRoot, path))) continue;
    const registered = candidates.get(path);
    discovered.push(
      registered ?? {
        documentId: documentIdForPath(path),
        path,
        connectedPaths: [],
        source: "instruction",
      },
    );
  }
  return discovered;
}
