import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

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

/** Applied owner rules (ADR-0467) are repository instructions every managed turn receives. */
export const GENERATED_INSTRUCTION_DIRECTORY = "docs/instructions/generated";
const GENERATED_RULE_FILE = /^rule_[a-f0-9]{24}\.md$/u;
const MAXIMUM_GENERATED_INSTRUCTIONS = 16;

export function isGeneratedInstructionPath(path: string): boolean {
  const prefix = `${GENERATED_INSTRUCTION_DIRECTORY}/`;
  return path.startsWith(prefix) && GENERATED_RULE_FILE.test(path.slice(prefix.length));
}

async function generatedInstructionPaths(repositoryRoot: string): Promise<string[]> {
  try {
    return (await readdir(resolve(repositoryRoot, GENERATED_INSTRUCTION_DIRECTORY)))
      .filter((name) => GENERATED_RULE_FILE.test(name))
      .sort(compareCanonicalText)
      .slice(0, MAXIMUM_GENERATED_INSTRUCTIONS)
      .map((name) => `${GENERATED_INSTRUCTION_DIRECTORY}/${name}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function discoverInstructionDocuments(input: {
  repositoryRoot: string;
  registry: DocumentRegistry;
  expectedPaths: readonly string[];
}): Promise<ContextDocumentCandidate[]> {
  const candidates = registryCandidates(input.registry);
  const discovered: ContextDocumentCandidate[] = [];
  for (const path of [
    ...instructionPathsFor(input.expectedPaths),
    ...(await generatedInstructionPaths(input.repositoryRoot)),
  ]) {
    if (!(await repositoryFileExists(input.repositoryRoot, path))) continue;
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
    });
  }
  return discovered;
}
