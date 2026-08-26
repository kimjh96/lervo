import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse, stringify } from "yaml";

import type { RepositoryKnowledgePolicy } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";
import { supportedRepositoryPublicationLanguages } from "./publication-language.js";

export const defaultRepositoryKnowledgePolicy: RepositoryKnowledgePolicy = {
  schemaVersion: 1,
  policyId: "knowledge.default",
  publicationRoot: "docs/knowledge",
  publication: {
    language: "en",
    maxNavigationEntries: 24,
    maxNavigationBytes: 8192,
  },
  exclude: [
    ".git/**",
    ".lervo/**",
    ".changes/**",
    "node_modules/**",
    "**/node_modules/**",
    "dist/**",
    "**/dist/**",
    "build/**",
    "**/build/**",
    "coverage/**",
    "**/coverage/**",
    ".next/**",
    "**/.next/**",
    ".turbo/**",
    "**/.turbo/**",
    ".expo/**",
    "**/.expo/**",
    ".gradle/**",
    "**/.gradle/**",
    ".cxx/**",
    "**/.cxx/**",
    "Pods/**",
    "**/Pods/**",
    "build-device/**",
    "**/build-device/**",
    "vendor/**",
    "**/vendor/**",
    "apps/node-runtime-dependencies/**",
    "apps/hub-runtime-dependencies/**",
  ],
  limits: {
    maxFiles: 20_000,
    maxFileBytes: 1_048_576,
    maxTotalBytes: 33_554_432,
  },
};

export function serializeRepositoryKnowledgePolicy(
  policy = defaultRepositoryKnowledgePolicy,
): string {
  return stringify(policy, { lineWidth: 0 });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateRepositoryKnowledgePolicy(value: unknown): RepositoryKnowledgePolicy {
  const item = value as Partial<RepositoryKnowledgePolicy> | null;
  const publication = item?.publication ?? defaultRepositoryKnowledgePolicy.publication;
  if (
    item === null ||
    typeof item !== "object" ||
    item.schemaVersion !== 1 ||
    typeof item.policyId !== "string" ||
    !/^[a-z][a-z0-9._-]{2,63}$/.test(item.policyId) ||
    typeof item.publicationRoot !== "string" ||
    item.publicationRoot.length === 0 ||
    item.publicationRoot.startsWith("/") ||
    item.publicationRoot.split("/").includes("..") ||
    typeof publication !== "object" ||
    publication === null ||
    typeof publication.language !== "string" ||
    !supportedRepositoryPublicationLanguages.includes(publication.language as "en") ||
    !Number.isSafeInteger(publication.maxNavigationEntries) ||
    publication.maxNavigationEntries < 4 ||
    publication.maxNavigationEntries > 128 ||
    !Number.isSafeInteger(publication.maxNavigationBytes) ||
    publication.maxNavigationBytes < 1024 ||
    publication.maxNavigationBytes > 65_536 ||
    !isStringArray(item.exclude) ||
    item.limits === undefined ||
    !Number.isSafeInteger(item.limits.maxFiles) ||
    item.limits.maxFiles < 1 ||
    !Number.isSafeInteger(item.limits.maxFileBytes) ||
    item.limits.maxFileBytes < 1 ||
    !Number.isSafeInteger(item.limits.maxTotalBytes) ||
    item.limits.maxTotalBytes < 1
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      ".lervo/knowledge/policy.yaml does not satisfy the repository knowledge policy contract.",
    );
  }
  return { ...(item as RepositoryKnowledgePolicy), publication: { ...publication } };
}

export async function loadRepositoryKnowledgePolicy(
  root: string,
): Promise<RepositoryKnowledgePolicy> {
  const path = resolve(root, ".lervo/knowledge/policy.yaml");
  let bytes: string;
  try {
    bytes = await readFile(path, "utf8");
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      `${path} cannot be read. Run lervo init first.`,
    );
  }
  try {
    return validateRepositoryKnowledgePolicy(parse(bytes));
  } catch (error) {
    if (error instanceof RepositoryKnowledgeError) throw error;
    throw new RepositoryKnowledgeError("knowledge_source_unsafe", `${path} is not valid YAML.`);
  }
}
