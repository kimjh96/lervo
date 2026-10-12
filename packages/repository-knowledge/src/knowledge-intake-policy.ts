import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { isTransientToolCachePath } from "@lervo/context";
import { parse } from "yaml";

import { defaultRepositoryKnowledgePolicy, validateRepositoryKnowledgePolicy } from "./policy.js";
import type { RepositoryKnowledgePolicy } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";

/**
 * Lervo-owned projections and state. Repository work observation excludes them from the work it
 * checkpoints; knowledge intake treats them as generated (ADR-0457).
 */
export const LERVO_PROJECTION_PREFIXES = [".lervo/generated/", ".lervo/state/", ".lervo/data/"];

/**
 * Generated artifacts that carry no repository knowledge of their own. A `**` prefix matches one
 * or more directories, so every nested pattern also names its root-level form.
 */
export const DEFAULT_GENERATED_INTAKE_PATTERNS = [
  ...LERVO_PROJECTION_PREFIXES.map((prefix) => `${prefix}**`),
  "docs/knowledge/**",
  ".changes/**",
  "release-*.json",
  "**/release-*.json",
  "release-sbom*.json",
  "**/release-sbom*.json",
  "*.lock",
  "**/*.lock",
  "pnpm-lock.yaml",
];

export type KnowledgeIntakeDisposition = "reviewable" | "generated";

/** The one inclusion policy shared by the scanner, the change source, and the change review. */
export interface KnowledgeIntakePolicy {
  /** Patterns the scanner excludes; projects extend them in `.lervo/knowledge/policy.yaml`. */
  readonly scannerExclude: readonly string[];
  /** Patterns a change review records as `generated` instead of reading. */
  readonly generated: readonly string[];
}

function globExpression(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escaped.replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", ".*")}$`,
  );
}

export function repositoryPathMatchesPatterns(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (globExpression(pattern).test(path)) return true;
    return pattern.endsWith("/**") && globExpression(pattern.slice(0, -3)).test(path);
  });
}

/** One observation owns its compiled policy; no file observation or process-wide state is reused. */
export function compileKnowledgeScannerExclusion(
  policy: Pick<RepositoryKnowledgePolicy, "exclude">,
): (path: string) => boolean {
  const expressions = policy.exclude.flatMap((pattern) => [
    globExpression(pattern),
    ...(pattern.endsWith("/**") ? [globExpression(pattern.slice(0, -3))] : []),
  ]);
  return (path) =>
    expressions.some((expression) => expression.test(path)) || isTransientToolCachePath(path);
}

/** True when the scanner leaves the path out of the repository inventory. */
export function knowledgeScannerExcludes(
  path: string,
  policy: Pick<RepositoryKnowledgePolicy, "exclude">,
): boolean {
  return repositoryPathMatchesPatterns(path, policy.exclude) || isTransientToolCachePath(path);
}

export function knowledgeIntakePolicy(
  policy: Pick<RepositoryKnowledgePolicy, "exclude"> = defaultRepositoryKnowledgePolicy,
): KnowledgeIntakePolicy {
  return {
    scannerExclude: [...policy.exclude],
    generated: [...new Set([...DEFAULT_GENERATED_INTAKE_PATTERNS, ...policy.exclude])],
  };
}

/** Scanner exclusions are generated for change review too, so both see the same sources. */
export function knowledgeIntakeDisposition(
  path: string,
  intake: KnowledgeIntakePolicy,
): KnowledgeIntakeDisposition {
  return repositoryPathMatchesPatterns(path, intake.generated) || isTransientToolCachePath(path)
    ? "generated"
    : "reviewable";
}

/**
 * Reads the project's policy; a repository without one uses the defaults. An unreadable or invalid
 * policy fails closed rather than widening what reaches a reviewer.
 */
export async function loadKnowledgeIntakePolicy(root: string): Promise<KnowledgeIntakePolicy> {
  let bytes: string;
  try {
    bytes = await readFile(resolve(root, ".lervo/knowledge/policy.yaml"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return knowledgeIntakePolicy();
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The repository knowledge policy cannot be read.",
      undefined,
      { cause: error },
    );
  }
  let value: unknown;
  try {
    value = parse(bytes);
  } catch (error) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The repository knowledge policy is not valid YAML.",
      undefined,
      { cause: error },
    );
  }
  return knowledgeIntakePolicy(validateRepositoryKnowledgePolicy(value));
}
