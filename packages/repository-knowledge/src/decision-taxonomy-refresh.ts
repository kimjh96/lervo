import { parse } from "yaml";
import {
  decisionTaxonomyRequiresUpgrade,
  seedRepositoryDocumentRoles,
  serializeDecisionTaxonomy,
  type DecisionTaxonomy,
} from "@lervo/project";

import { sha256 } from "./integrity.js";
import type { KnowledgeFileOperation } from "./types.js";

export const decisionTaxonomyPath = ".lervo/knowledge/document-layout.yaml";

/**
 * Plans the Lervo-managed layout rewrite that upgrades a legacy taxonomy (schema 1, or routes
 * whose title terms ADR-0476 replaces with prose descriptions), prunes unmodified
 * Lervo role templates whose paths and aliases are all absent, and re-adds a template this plan
 * places a document into. Declared roles are never touched.
 */
export function planDecisionTaxonomyRefresh(input: {
  taxonomySource: string;
  taxonomy: DecisionTaxonomy;
  pathExists: (path: string) => boolean;
  /** Destinations this plan moves documents to; they bind (or re-add) template roles. */
  placedPaths: ReadonlySet<string>;
}): KnowledgeFileOperation[] {
  const current = input.taxonomy.documentPolicy.roles;
  const roles = seedRepositoryDocumentRoles(current, input.pathExists, input.placedPaths);
  const changed =
    roles.length !== current.length || roles.some((role, index) => role !== current[index]);
  const written = parse(input.taxonomySource) as { schemaVersion?: unknown } | null;
  const upgrade = decisionTaxonomyRequiresUpgrade(written);
  if (!changed && !upgrade) return [];
  const content = serializeDecisionTaxonomy({
    ...input.taxonomy,
    documentPolicy: { ...input.taxonomy.documentPolicy, roles },
  });
  return [
    {
      path: decisionTaxonomyPath,
      action: "update",
      ownership: "lervo_generated",
      mediaType: "application/yaml",
      content,
      expectedCurrentHash: sha256(input.taxonomySource),
      desiredHash: sha256(content),
      reason: !upgrade
        ? "bind_document_role_templates"
        : written?.schemaVersion === 1
          ? "upgrade_document_policy"
          : "describe_semantic_routes",
    },
  ];
}
