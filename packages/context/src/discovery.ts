import { resolveInstructionPrecedence } from "./instruction-precedence.js";
import type { InstructionTargets } from "./instruction-conditions.js";
import type { DocumentRegistry } from "@lervo/schemas";

import { generatedInstructionPaths, readInstructionSource } from "./instruction-sources.js";
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
      documentRole: "task_evidence" as const,
      referenceEligible: true,
    });
  }
  return candidates;
}

export function candidatesFromRegistry(registry: DocumentRegistry): ContextDocumentCandidate[] {
  return [...registryCandidates(registry).values()].sort((left, right) =>
    compareCanonicalText(left.path, right.path),
  );
}

export {
  GENERATED_INSTRUCTION_DIRECTORY,
  isGeneratedInstructionPath,
} from "./instruction-sources.js";

export async function discoverInstructionDocuments(input: {
  repositoryRoot: string;
  registry: DocumentRegistry;
  expectedPaths: readonly string[];
  instructionTargets?: InstructionTargets;
}): Promise<ContextDocumentCandidate[]> {
  const candidates = registryCandidates(input.registry);
  const discovered: ContextDocumentCandidate[] = [];
  const sources = [];
  for (const path of [
    ...instructionPathsFor(input.expectedPaths),
    ...(await generatedInstructionPaths(input.repositoryRoot)),
  ]) {
    if (!(await repositoryFileExists(input.repositoryRoot, path))) continue;
    sources.push(
      await readInstructionSource(
        input.repositoryRoot,
        path,
        input.expectedPaths,
        input.instructionTargets,
      ),
    );
  }
  for (const source of resolveInstructionPrecedence(sources)) {
    const path = source.path;
    if (
      source.applicability === "conflict" ||
      (source.conditions && source.applicability === "unresolved")
    )
      throw new ContextPreparationError(
        "required_rule_unresolved",
        "Instruction conditions require resolution before managed preparation.",
      );
    if (source.applicability === "not_applicable") continue;
    const registered = candidates.get(path);
    discovered.push({
      ...(registered ?? {
        documentId: documentIdForPath(path),
        path,
        connectedPaths: [],
        source: "instruction",
        documentRole: "governance_context",
        referenceEligible: false,
      }),
      documentRole: "governance_context",
      referenceEligible: false,
      expectedContentHash: source.contentHash,
    });
  }
  return discovered;
}
