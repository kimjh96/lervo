import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  projectManagedIgnoreConfiguration,
  type DocumentRewriterDescriptor,
} from "@lervo/documents";
import { loadDecisionTaxonomy, loadProjectManifest } from "@lervo/project";

import { sha256 } from "./integrity.js";
import { loadRepositoryKnowledgePolicy } from "./policy.js";
import { scanRepositoryKnowledge } from "./scanner.js";

async function optionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function projectRepositoryPrettierRewrite(input: {
  repositoryRoot: string;
  ownedPaths: readonly string[];
  supplementalDocumentPaths?: readonly string[];
}): Promise<{
  descriptor: DocumentRewriterDescriptor;
  beforeContent: string | null;
  afterContent: string;
  rules: string[];
  userRegionHash: string;
  approvalRequired: boolean;
}> {
  const root = resolve(input.repositoryRoot);
  const [manifest, sourcePolicy, taxonomy, ignore, prettierConfig, lock] = await Promise.all([
    loadProjectManifest(root),
    loadRepositoryKnowledgePolicy(root),
    loadDecisionTaxonomy(root),
    optionalFile(resolve(root, ".prettierignore")),
    optionalFile(resolve(root, ".prettierrc.json")),
    optionalFile(resolve(root, "pnpm-lock.yaml")),
  ]);
  const scan = await scanRepositoryKnowledge({
    repositoryRoot: root,
    projectId: manifest.projectId,
    policy: sourcePolicy,
  });
  const allDocumentPaths = [
    ...new Set([
      ...scan.sources.flatMap((source) =>
        source.status === "included" && /\.mdx?$/iu.test(source.path) ? [source.path] : [],
      ),
      ...(input.supplementalDocumentPaths ?? []),
    ]),
  ].sort();
  const projection = projectManagedIgnoreConfiguration({
    currentContent: ignore,
    ownedPaths: [...new Set(input.ownedPaths)].sort(),
    allDocumentPaths,
    maximumRules: taxonomy.documentPolicy.rewrite.maxManagedRulesPerRewriter,
    maximumBytes: taxonomy.documentPolicy.rewrite.maxManagedRuleBytes,
  });
  return {
    descriptor: {
      rewriterId: "prettier",
      version: "3",
      capability: "format",
      scopePaths: ["."],
      configurationHash: sha256(`${prettierConfig ?? ""}\n${ignore ?? ""}`),
      lockHash: sha256(lock ?? ""),
      compatibility: {
        kind: "managed_ignore",
        configurationPath: ".prettierignore",
        maximumManagedRuleCount: taxonomy.documentPolicy.rewrite.maxManagedRulesPerRewriter,
      },
    },
    beforeContent: ignore,
    afterContent: projection.content,
    rules: projection.rules,
    userRegionHash: projection.userRegionHash,
    approvalRequired: projection.approvalRequired,
  };
}
