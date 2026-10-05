import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  documentRoleCandidatePaths,
  isConditionalDefaultDocumentRole,
  type DecisionTaxonomy,
} from "@lervo/project";

import { extractDocumentReferences, type DocumentReference } from "./document-references.js";
import { archiveScopes, historicalDocumentMarker } from "./historical-documents.js";
import { knowledgeIntakeDisposition, knowledgeIntakePolicy } from "./knowledge-intake-policy.js";
import type {
  KnowledgeLintIssue,
  RepositoryKnowledgePolicy,
  RepositoryKnowledgeScan,
  RepositorySource,
} from "./types.js";

/** Root entrypoints whose user-owned prose is checked for references (ADR-0464). */
export const referenceCheckedEntrypoints = ["README.md", "AGENTS.md", "CLAUDE.md"] as const;

/** Per-code bound; further findings collapse into one truncation finding. */
export const MAXIMUM_REFERENCE_FINDINGS_PER_CODE = 64;
const MAXIMUM_SYMBOL_FILE_BYTES = 1024 * 1024;

export type DocumentReferenceLintCode =
  "document_role_target_missing" | "markdown_link_target_missing" | "entrypoint_reference_missing";

/**
 * Included Markdown sources describing the current repository. Historical documents are frozen
 * records, so reference and staleness checks skip them (ADR-0464).
 */
export function currentMarkdownDocumentSources(
  scan: RepositoryKnowledgeScan,
  taxonomy: DecisionTaxonomy | null,
): RepositorySource[] {
  const scopes = archiveScopes(taxonomy);
  return scan.sources
    .filter(
      (source) =>
        source.status === "included" &&
        source.content !== undefined &&
        /\.mdx?$/iu.test(source.path) &&
        historicalDocumentMarker({
          path: source.path,
          content: source.content,
          archiveScopes: scopes,
        }) === null,
    )
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

/** Answers path existence from the scan inventory, confirming misses on the filesystem. */
export function repositoryPathOracle(root: string, scan: RepositoryKnowledgeScan) {
  const files = new Set(scan.sources.map((source) => source.path));
  const directories = new Set<string>();
  for (const path of files) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1)
      directories.add(segments.slice(0, index).join("/"));
  }
  const confirmed = new Map<string, Promise<boolean>>();
  return {
    topLevel: (segment: string) => files.has(segment) || directories.has(segment),
    exists(path: string): Promise<boolean> {
      if (files.has(path) || directories.has(path)) return Promise.resolve(true);
      let observation = confirmed.get(path);
      if (observation === undefined) {
        observation = lstat(resolve(root, path)).then(
          () => true,
          () => false,
        );
        confirmed.set(path, observation);
      }
      return observation;
    },
  };
}

export function referenceTargetIgnored(input: {
  target: string;
  policy: RepositoryKnowledgePolicy;
  generatedPaths: ReadonlySet<string>;
}): boolean {
  const publicationRoot = input.policy.publicationRoot.replace(/\/$/u, "");
  return (
    input.generatedPaths.has(input.target) ||
    input.target === publicationRoot ||
    input.target.startsWith(`${publicationRoot}/`) ||
    input.target === ".lervo/state" ||
    input.target.startsWith(".lervo/state/") ||
    knowledgeIntakeDisposition(input.target, knowledgeIntakePolicy(input.policy)) === "generated"
  );
}

const managedBegin = /^<!-- lervo:begin block=([a-z][a-z0-9_-]{0,99}) schema=\d+ -->$/u;

/**
 * Blanks every Lervo-managed block of any schema version, keeping line numbers. Lervo owns that
 * text, so its references are verified by the owning projection instead of entrypoint lint.
 */
function userOwnedProse(content: string): string {
  let open: string | null = null;
  return content
    .split("\n")
    .map((line) => {
      const text = line.replace(/\r$/u, "");
      if (open === null) {
        open = managedBegin.exec(text)?.[1] ?? null;
        return open === null ? line : "";
      }
      if (text === `<!-- lervo:end block=${open} -->`) open = null;
      return "";
    })
    .join("\n");
}

async function symbolPresent(root: string, path: string, symbol: string): Promise<boolean | null> {
  try {
    const target = resolve(root, path);
    const stats = await lstat(target);
    if (!stats.isFile() || stats.size > MAXIMUM_SYMBOL_FILE_BYTES) return null;
    const name = symbol.split(".").at(-1)!.replace(/[$]/gu, "\\$");
    return new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`, "u").test(
      await readFile(target, "utf8"),
    );
  } catch {
    return null;
  }
}

async function roleIssues(input: {
  taxonomy: DecisionTaxonomy | null;
  exists: (path: string) => Promise<boolean>;
}): Promise<KnowledgeLintIssue[]> {
  const issues: KnowledgeLintIssue[] = [];
  for (const role of input.taxonomy?.documentPolicy.roles ?? []) {
    // Required roles fail through document_role_conflict; Lervo-owned roles appear lazily.
    if (role.required || role.lifecycleOwner === "lervo") continue;
    const candidates = documentRoleCandidatePaths(role);
    if ((await Promise.all(candidates.map((path) => input.exists(path)))).includes(true)) continue;
    if (isConditionalDefaultDocumentRole(role)) continue;
    issues.push({
      code: "document_role_target_missing",
      severity: "warning",
      path: role.path,
      target: role.path,
      message: `The optional document role ${role.roleId} has no file at ${role.path} or its legacy aliases.`,
    });
  }
  return issues;
}

async function entrypointIssues(input: {
  root: string;
  source: RepositorySource;
  references: readonly DocumentReference[];
  oracle: ReturnType<typeof repositoryPathOracle>;
  ignored: (target: string) => boolean;
}): Promise<KnowledgeLintIssue[]> {
  const issues: KnowledgeLintIssue[] = [];
  for (const reference of input.references) {
    if (reference.target === input.source.path || input.ignored(reference.target)) continue;
    if (reference.weak && !input.oracle.topLevel(reference.target.split("/")[0]!)) continue;
    const present = await input.oracle.exists(reference.target);
    if (!present) {
      issues.push({
        code: "entrypoint_reference_missing",
        severity: "warning",
        path: input.source.path,
        target: reference.target,
        reasons: ["path_missing"],
        message: `Line ${reference.line} references ${reference.target}, which does not exist.`,
      });
      continue;
    }
    if (reference.kind !== "code_symbol") continue;
    if ((await symbolPresent(input.root, reference.target, reference.symbol!)) !== false) continue;
    issues.push({
      code: "entrypoint_reference_missing",
      severity: "warning",
      path: input.source.path,
      target: reference.target,
      reasons: ["symbol_missing"],
      message: `Line ${reference.line} references symbol ${reference.symbol} in ${reference.target}, which no longer contains it.`,
    });
  }
  return issues;
}

async function markdownLinkIssues(input: {
  source: RepositorySource;
  references: readonly DocumentReference[];
  oracle: ReturnType<typeof repositoryPathOracle>;
  ignored: (target: string) => boolean;
}): Promise<KnowledgeLintIssue[]> {
  const issues: KnowledgeLintIssue[] = [];
  for (const reference of input.references) {
    if (reference.kind !== "markdown_link" || input.ignored(reference.target)) continue;
    if (await input.oracle.exists(reference.target)) continue;
    issues.push({
      code: "markdown_link_target_missing",
      severity: "warning",
      path: input.source.path,
      target: reference.target,
      message: `Line ${reference.line} links to ${reference.target}, which does not exist.`,
    });
  }
  return issues;
}

function bounded(issues: KnowledgeLintIssue[]): KnowledgeLintIssue[] {
  const byCode = new Map<string, KnowledgeLintIssue[]>();
  for (const issue of issues) {
    const values = byCode.get(issue.code) ?? [];
    values.push(issue);
    byCode.set(issue.code, values);
  }
  const result: KnowledgeLintIssue[] = [];
  for (const code of [...byCode.keys()].sort()) {
    const values = byCode.get(code)!;
    result.push(...values.slice(0, MAXIMUM_REFERENCE_FINDINGS_PER_CODE));
    if (values.length > MAXIMUM_REFERENCE_FINDINGS_PER_CODE)
      result.push({
        code: "document_reference_findings_truncated",
        severity: "warning",
        path: ".",
        reasons: [code],
        message: `${values.length - MAXIMUM_REFERENCE_FINDINGS_PER_CODE} additional ${code} findings were omitted from this bounded report.`,
      });
  }
  return result;
}

/**
 * Reports missing optional role targets, broken relative Markdown links, and entrypoint
 * references to missing repository paths or symbols. It reads only; findings are warnings.
 */
export async function lintDocumentReferences(input: {
  root: string;
  scan: RepositoryKnowledgeScan;
  policy: RepositoryKnowledgePolicy;
  generatedPaths: ReadonlySet<string>;
  taxonomy: DecisionTaxonomy | null;
}): Promise<KnowledgeLintIssue[]> {
  const oracle = repositoryPathOracle(input.root, input.scan);
  const ignored = (target: string) =>
    referenceTargetIgnored({ target, policy: input.policy, generatedPaths: input.generatedPaths });
  // The filesystem, not the scan, answers role targets: generated entrypoints are not scanned.
  const issues: KnowledgeLintIssue[] = await roleIssues({
    taxonomy: input.taxonomy,
    exists: (path) => oracle.exists(path),
  });
  const entrypoints = new Set<string>(referenceCheckedEntrypoints);
  for (const source of currentMarkdownDocumentSources(input.scan, input.taxonomy)) {
    if (entrypoints.has(source.path)) {
      const references = extractDocumentReferences({
        path: source.path,
        content: userOwnedProse(source.content!),
      });
      issues.push(
        ...(await entrypointIssues({ root: input.root, source, references, oracle, ignored })),
      );
      continue;
    }
    const references = extractDocumentReferences({ path: source.path, content: source.content! });
    issues.push(...(await markdownLinkIssues({ source, references, oracle, ignored })));
  }
  return bounded(
    issues.sort(
      (left, right) =>
        compare(left.code, right.code) ||
        compare(left.path, right.path) ||
        compare(left.target ?? "", right.target ?? "") ||
        compare(left.message, right.message),
    ),
  );
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
