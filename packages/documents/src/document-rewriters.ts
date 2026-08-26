import { posix } from "node:path";

import type {
  RepositoryDocumentRewriteContract,
  RepositoryDocumentRewritePolicy,
} from "@lervo/project";

import { sha256 } from "./hash.js";

export type DocumentRewriteCapability = "format" | "autofix" | "transform" | "generate";

export interface DocumentRewriterDescriptor {
  rewriterId: string;
  version: string;
  capability: DocumentRewriteCapability;
  scopePaths: string[];
  configurationHash: string;
  lockHash: string;
  compatibility:
    | { kind: "managed_ignore"; configurationPath: string; maximumManagedRuleCount: number }
    | { kind: "content_bound_dry_run"; maximumObservations: number }
    | { kind: "unmanaged" };
}

export interface DocumentRewriteOwnership {
  path: string;
  owner: "repository_tool" | "lervo" | "reviewer" | "shared_regions";
  rewritePolicy: RepositoryDocumentRewritePolicy;
}

export interface DocumentRewriteDryRunObservation {
  path: string;
  beforeHash: string;
  afterHash: string;
}

export type DocumentRewriteBlocker =
  | {
      code: "document_rewrite_ownership_conflict";
      path: string;
      owner: string;
      rewriterId: string;
      policyHash: string;
    }
  | {
      code: "document_rewrite_rule_capacity_exceeded";
      rewriterId: string;
      observed: number;
      projected: number;
      limit: number;
    }
  | {
      code: "document_rewriter_unmanaged";
      capability: DocumentRewriteCapability;
      scopeDigest: string;
      observationSource: string;
    };

function inScope(path: string, scopes: readonly string[]): boolean {
  return scopes.some(
    (scope) => scope === "." || path === scope || path.startsWith(`${scope.replace(/\/$/u, "")}/`),
  );
}

function ignored(path: string, rules: readonly string[]): boolean {
  return rules.some((rule) => (rule.endsWith("/") ? path.startsWith(rule) : path === rule));
}

export function evaluateDocumentRewriters(input: {
  ownership: readonly DocumentRewriteOwnership[];
  rewriters: readonly DocumentRewriterDescriptor[];
  managedRules: Readonly<Record<string, readonly string[]>>;
  dryRuns: Readonly<Record<string, readonly DocumentRewriteDryRunObservation[]>>;
  contract: RepositoryDocumentRewriteContract;
  policyHash: string;
}): { status: "compatible" | "blocked"; blockers: DocumentRewriteBlocker[] } {
  const blockers: DocumentRewriteBlocker[] = [];
  if (input.rewriters.length > input.contract.maxRewriters)
    blockers.push({
      code: "document_rewrite_rule_capacity_exceeded",
      rewriterId: "registry",
      observed: input.rewriters.length,
      projected: input.rewriters.length,
      limit: input.contract.maxRewriters,
    });
  const ids = new Set<string>();
  for (const rewriter of input.rewriters) {
    if (ids.has(rewriter.rewriterId)) {
      blockers.push({
        code: "document_rewrite_ownership_conflict",
        path: ".",
        owner: "rewriter_registry",
        rewriterId: rewriter.rewriterId,
        policyHash: input.policyHash,
      });
      continue;
    }
    ids.add(rewriter.rewriterId);
    if (rewriter.compatibility.kind === "unmanaged") {
      blockers.push({
        code: "document_rewriter_unmanaged",
        capability: rewriter.capability,
        scopeDigest: sha256(rewriter.scopePaths.join("\n")),
        observationSource: rewriter.rewriterId,
      });
      continue;
    }
    const rules = input.managedRules[rewriter.rewriterId] ?? [];
    if (
      rewriter.compatibility.kind === "managed_ignore" &&
      (rules.length > rewriter.compatibility.maximumManagedRuleCount ||
        rules.length > input.contract.maxManagedRulesPerRewriter)
    )
      blockers.push({
        code: "document_rewrite_rule_capacity_exceeded",
        rewriterId: rewriter.rewriterId,
        observed: rules.length,
        projected: rules.length,
        limit: Math.min(
          rewriter.compatibility.maximumManagedRuleCount,
          input.contract.maxManagedRulesPerRewriter,
        ),
      });
    const dryRuns = new Map(
      (input.dryRuns[rewriter.rewriterId] ?? []).map((observation) => [
        observation.path,
        observation,
      ]),
    );
    if (
      rewriter.compatibility.kind === "content_bound_dry_run" &&
      dryRuns.size > rewriter.compatibility.maximumObservations
    )
      blockers.push({
        code: "document_rewrite_rule_capacity_exceeded",
        rewriterId: rewriter.rewriterId,
        observed: dryRuns.size,
        projected: dryRuns.size,
        limit: rewriter.compatibility.maximumObservations,
      });
    for (const ownership of input.ownership) {
      if (
        !inScope(ownership.path, rewriter.scopePaths) ||
        !["lervo_exact", "reviewed_exact"].includes(ownership.rewritePolicy)
      )
        continue;
      const compatible =
        rewriter.compatibility.kind === "managed_ignore"
          ? ignored(ownership.path, rules)
          : (() => {
              const observation = dryRuns.get(ownership.path);
              return observation !== undefined && observation.beforeHash === observation.afterHash;
            })();
      if (!compatible)
        blockers.push({
          code: "document_rewrite_ownership_conflict",
          path: ownership.path,
          owner: ownership.owner,
          rewriterId: rewriter.rewriterId,
          policyHash: input.policyHash,
        });
    }
  }
  return { status: blockers.length === 0 ? "compatible" : "blocked", blockers };
}

const BEGIN = "# lervo:begin document-rewrite-ownership schema=1";
const END = "# lervo:end document-rewrite-ownership";

function compactRules(
  ownedPaths: readonly string[],
  allDocumentPaths: readonly string[],
): string[] {
  const owned = new Set(ownedPaths);
  const all = new Set(allDocumentPaths);
  const candidates = new Map<string, string[]>();
  for (const path of owned) {
    let directory = posix.dirname(path);
    while (directory !== ".") {
      const paths = candidates.get(directory) ?? [];
      paths.push(path);
      candidates.set(directory, paths);
      directory = posix.dirname(directory);
    }
  }
  const compacted = new Set<string>();
  const covered = new Set<string>();
  for (const [directory, paths] of [...candidates].sort(
    (left, right) => left[0].split("/").length - right[0].split("/").length,
  )) {
    if ([...compacted].some((rule) => directory.startsWith(rule))) continue;
    const documents = [...all].filter((path) => path.startsWith(`${directory}/`));
    if (paths.length < 3 || documents.length === 0 || documents.some((path) => !owned.has(path)))
      continue;
    compacted.add(`${directory}/`);
    for (const path of paths) covered.add(path);
  }
  return [...compacted, ...[...owned].filter((path) => !covered.has(path))].sort();
}

export function projectManagedIgnoreConfiguration(input: {
  currentContent: string | null;
  ownedPaths: readonly string[];
  allDocumentPaths: readonly string[];
  maximumRules: number;
  maximumBytes: number;
}): {
  content: string;
  rules: string[];
  userRegionHash: string;
  approvalRequired: boolean;
} {
  const current = input.currentContent ?? "";
  const begin = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (
    begin < 0 !== end < 0 ||
    current.indexOf(BEGIN, begin + 1) >= 0 ||
    current.indexOf(END, end + 1) >= 0
  )
    throw new Error("The managed document rewrite block is malformed or duplicated.");
  if (begin >= 0 && end < begin)
    throw new Error("The managed document rewrite block is malformed.");
  const userRegion =
    begin < 0
      ? current
      : `${current.slice(0, begin)}${current.slice(end + END.length).replace(/^\n/u, "")}`;
  if (userRegion.split(/\r?\n/u).some((line) => line.trimStart().startsWith("!")))
    throw new Error("Negated ignore rules are not safe for managed document ownership.");
  const rules = compactRules(input.ownedPaths, input.allDocumentPaths);
  if (rules.length > input.maximumRules)
    throw new Error("The managed document rewrite rule projection exceeds its finite limit.");
  const block = rules.length === 0 ? "" : `${BEGIN}\n${rules.join("\n")}\n${END}\n`;
  const separator = userRegion.length > 0 && !userRegion.endsWith("\n") ? "\n" : "";
  const content = `${userRegion}${separator}${block}`;
  if (Buffer.byteLength(block) > input.maximumBytes)
    throw new Error("The managed document rewrite block exceeds its finite byte limit.");
  return {
    content,
    rules,
    userRegionHash: sha256(userRegion),
    approvalRequired: input.currentContent !== null && begin < 0 && current.length > 0,
  };
}
