import {
  DecisionTaxonomyContractError,
  LervoProjectError,
  loadDecisionTaxonomy,
} from "@lervo/project";

import type { KnowledgeMigrationBlocker } from "./types.js";

const documentLayoutPath = ".lervo/knowledge/document-layout.yaml" as const;

/**
 * Loads the tracked document layout the same way apply-time lint does and
 * returns the failure as plan blockers, so a plan never reports ready for a
 * layout that apply would reject.
 */
export async function inspectDocumentLayoutContract(
  repositoryRoot: string,
): Promise<KnowledgeMigrationBlocker[]> {
  try {
    await loadDecisionTaxonomy(repositoryRoot);
    return [];
  } catch (error) {
    if (error instanceof DecisionTaxonomyContractError)
      return [
        {
          code: "document_layout_contract_invalid",
          path: documentLayoutPath,
          message: error.message,
          issues: [...error.issues],
        },
      ];
    if (error instanceof LervoProjectError && error.code === "invalid_yaml")
      return [
        {
          code: "document_layout_invalid_yaml",
          path: documentLayoutPath,
          message: `${documentLayoutPath} is not valid YAML.`,
          issues: [],
        },
      ];
    if (error instanceof LervoProjectError && error.code === "not_initialized")
      return [
        {
          code: "document_layout_unreadable",
          path: documentLayoutPath,
          message: `${documentLayoutPath} cannot be read. Run lervo init to install the tracked decision taxonomy.`,
          issues: [],
        },
      ];
    throw error;
  }
}
