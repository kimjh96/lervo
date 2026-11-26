import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse, stringify } from "yaml";
import { transientToolCacheDirectoryNames } from "@lervo/context";

import type { RepositoryKnowledgePolicy } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";
import { supportedRepositoryPublicationLanguages } from "./publication-language.js";
import { documentFreshnessPolicySectionValid } from "./document-freshness-policy.js";
import {
  defaultWorkstreamFreshnessPolicy,
  type WorkstreamFreshnessPolicy,
} from "./workstream-freshness.js";

export const defaultRepositoryKnowledgePolicy: RepositoryKnowledgePolicy = {
  schemaVersion: 1,
  policyId: "knowledge.default",
  publicationRoot: "docs/knowledge",
  publication: {
    language: "en",
    maxNavigationEntries: 24,
    maxNavigationBytes: 8192,
  },
  normalization: { exclude: [] },
  exclude: [
    ".git/**",
    ".lervo/**",
    ".changes/**",
    ".venv/**",
    "**/.venv/**",
    "venv/**",
    "**/venv/**",
    ...transientToolCacheDirectoryNames.flatMap((name) => [`${name}/**`, `**/${name}/**`]),
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
    maxTotalBytes: 67_108_864,
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

function boundedInteger(value: unknown, minimum: number, maximum: number): boolean {
  return (
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  );
}

function workstreamPolicyValid(value: unknown): boolean {
  if (value === undefined) return true;
  const item = value as Partial<WorkstreamFreshnessPolicy> | null;
  return (
    item !== null &&
    typeof item === "object" &&
    Object.keys(item).every((key) => key === "staleAfterCommits" || key === "staleAfterHours") &&
    boundedInteger(item.staleAfterCommits, 1, 100_000) &&
    boundedInteger(item.staleAfterHours, 1, 8_760)
  );
}

/** Thresholds for workstream staleness: the policy section when present, else the defaults. */
export function workstreamFreshnessPolicy(
  policy: Pick<RepositoryKnowledgePolicy, "workstream">,
): WorkstreamFreshnessPolicy {
  return policy.workstream === undefined
    ? { ...defaultWorkstreamFreshnessPolicy }
    : { ...policy.workstream };
}

export function validateRepositoryKnowledgePolicy(value: unknown): RepositoryKnowledgePolicy {
  const item = value as Partial<RepositoryKnowledgePolicy> | null;
  const publication = item?.publication ?? defaultRepositoryKnowledgePolicy.publication;
  const normalization = item?.normalization ?? defaultRepositoryKnowledgePolicy.normalization!;
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
    typeof normalization !== "object" ||
    normalization === null ||
    !isStringArray(normalization.exclude) ||
    !isStringArray(item.exclude) ||
    item.limits === undefined ||
    !Number.isSafeInteger(item.limits.maxFiles) ||
    item.limits.maxFiles < 1 ||
    !Number.isSafeInteger(item.limits.maxFileBytes) ||
    item.limits.maxFileBytes < 1 ||
    !Number.isSafeInteger(item.limits.maxTotalBytes) ||
    item.limits.maxTotalBytes < 1 ||
    !workstreamPolicyValid(item.workstream) ||
    !documentFreshnessPolicySectionValid(item.documentFreshness)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      ".lervo/knowledge/policy.yaml does not satisfy the repository knowledge policy contract.",
    );
  }
  return {
    ...(item as RepositoryKnowledgePolicy),
    publication: { ...publication },
    normalization: { exclude: [...normalization.exclude] },
    ...(item.workstream === undefined ? {} : { workstream: { ...item.workstream } }),
    ...(item.documentFreshness === undefined
      ? {}
      : { documentFreshness: { ...item.documentFreshness } }),
  };
}

export async function loadRepositoryKnowledgePolicy(
  root: string,
): Promise<RepositoryKnowledgePolicy> {
  const path = resolve(root, ".lervo/knowledge/policy.yaml");
  let bytes: string;
  try {
    bytes = await readFile(path, "utf8");
  } catch (error) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      `${path} cannot be read. Run lervo init first.`,
      undefined,
      { cause: error },
    );
  }
  try {
    return validateRepositoryKnowledgePolicy(parse(bytes));
  } catch (error) {
    if (error instanceof RepositoryKnowledgeError) throw error;
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      `${path} is not valid YAML.`,
      undefined,
      { cause: error },
    );
  }
}
