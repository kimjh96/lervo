import { execFile } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { loadDecisionTaxonomy, type DecisionTaxonomy } from "@lervo/project";

import { documentFreshnessDocumentOwnership } from "./document-freshness-classification.js";
import type {
  DocumentFreshnessFindingSource,
  DocumentFreshnessFindingV1,
  DocumentFreshnessOwnership,
  DocumentFreshnessPathChange,
} from "./document-freshness-contract.js";
import { documentFreshnessFinding } from "./document-freshness-finding.js";
import { filesystemDocumentFreshnessOracle } from "./document-freshness-filesystem-oracle.js";
import { documentFreshnessPublicationGroup } from "./document-freshness-publication-group.js";
import { documentFreshnessReferences } from "./document-freshness-references.js";
import type { DocumentStalenessFinding } from "./document-staleness-evaluation.js";
import { gitDocumentStalenessPort } from "./document-staleness-git.js";
import { readRecordedDocumentStalenessReport } from "./document-staleness-state.js";
import { archiveScopes } from "./historical-documents.js";
import { observeToolGeneratedDocuments } from "./document-tool-ownership-observation.js";
import { sha256 } from "./integrity.js";
import { lintRepositoryKnowledge } from "./lint-query.js";
import { loadRepositoryKnowledgePolicy } from "./policy.js";
import type { KnowledgeLintResult } from "./types.js";

const execute = promisify(execFile);
const MAXIMUM_FINDINGS = 256;
const MAXIMUM_TEXT_BYTES = 1024 * 1024;
const MAXIMUM_MISSING_TARGET_LOOKUPS = 32;
const findingCodes: ReadonlyMap<string, DocumentFreshnessFindingSource> = new Map([
  ["entrypoint_reference_missing", "entrypoint_reference_missing"],
  ["markdown_link_target_missing", "markdown_link_target_missing"],
]);
export interface DocumentFreshnessObservation {
  status: "observed" | "unavailable";
  currentRevision: string | null;
  /** True when the staleness projection matched the current revision and contributed findings. */
  stalenessReportCurrent: boolean;
  findings: DocumentFreshnessFindingV1[];
  truncated: number;
}

async function git(root: string, args: string[], maxBuffer = 16 * 1024 * 1024): Promise<string> {
  const { stdout } = await execute("git", ["--no-optional-locks", "-C", root, ...args], {
    encoding: "utf8",
    maxBuffer,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    timeout: 60_000,
    windowsHide: true,
  });
  return stdout;
}

async function renameTarget(
  root: string,
  path: string,
): Promise<{ deletedIn: string | null; renamedTo: string | null }> {
  try {
    const deletedIn = (
      await git(root, ["log", "-1", "--first-parent", "--format=%H", "--diff-filter=D", "--", path])
    ).trim();
    if (!/^[a-f0-9]{40,64}$/u.test(deletedIn)) return { deletedIn: null, renamedTo: null };
    const records = (
      await git(root, ["diff", "--name-status", "-z", "-M50%", `${deletedIn}^`, deletedIn])
    ).split("\0");
    for (let index = 0; index < records.length; index += 1) {
      const status = records[index]!;
      if (status.startsWith("R")) {
        const from = records[index + 1];
        const to = records[index + 2];
        index += 2;
        if (from === path && to !== undefined) return { deletedIn, renamedTo: to };
      } else if (status !== "") index += 1;
    }
    return { deletedIn, renamedTo: null };
  } catch {
    return { deletedIn: null, renamedTo: null };
  }
}

async function connectedPathChanges(input: {
  root: string;
  head: string;
  staleness: DocumentStalenessFinding | undefined;
  missingTargets: readonly string[];
}): Promise<DocumentFreshnessPathChange[]> {
  const changes = new Map<string, DocumentFreshnessPathChange>();
  const verified = input.staleness?.verifiedRevision ?? null;
  const changed = input.staleness?.changedPaths ?? [];
  if (verified !== null && changed.length > 0) {
    const lookups = changed.flatMap((path) => [`${verified}:${path}`, `${input.head}:${path}`]);
    const objects = await gitDocumentStalenessPort(input.root).objectNames(lookups);
    for (const path of changed) {
      const before = objects.get(`${verified}:${path}`) ?? null;
      const after = objects.get(`${input.head}:${path}`) ?? null;
      const removed = before !== null && after === null;
      const rename = removed ? await renameTarget(input.root, path) : null;
      changes.set(path, {
        path,
        beforeHash: before === null ? null : sha256(before),
        afterHash: after === null ? null : sha256(after),
        disposition:
          before === null
            ? "added"
            : removed
              ? rename?.renamedTo
                ? "renamed"
                : "deleted"
              : "modified",
        renamedTo: rename?.renamedTo ?? null,
      });
    }
  }
  for (const path of input.missingTargets.slice(0, MAXIMUM_MISSING_TARGET_LOOKUPS)) {
    if (changes.has(path)) continue;
    const rename = await renameTarget(input.root, path);
    changes.set(path, {
      path,
      beforeHash: null,
      afterHash: null,
      disposition: rename.renamedTo === null ? "deleted" : "renamed",
      renamedTo: rename.renamedTo,
    });
  }
  return [...changes.values()];
}

/** Maps every superseded document to the current document that names it as superseded. */
async function supersededDocuments(root: string): Promise<Map<string, string>> {
  const successors = new Map<string, string>();
  let output: string;
  try {
    output = await git(root, ["grep", "-n", "-I", "-i", "-E", "supersede[sd]?", "--", "*.md"]);
  } catch {
    return successors;
  }
  for (const line of output.split("\n").slice(0, 4096)) {
    const match = /^([^:]+):\d+:(.*)$/u.exec(line);
    if (match === null || !/\bsupersedes\b/iu.test(match[2]!)) continue;
    const source = match[1]!;
    for (const link of match[2]!.matchAll(/\]\(([^)\s#?]+)/gu)) {
      const target = resolve("/", source, "..", link[1]!).slice(1);
      if (target !== source && !successors.has(target)) successors.set(target, source);
    }
  }
  return successors;
}

/** Whole-document ownership resolver for one repository, loaded once per observation. */
export async function documentFreshnessOwnershipResolver(
  repositoryRoot: string,
): Promise<(path: string) => DocumentFreshnessOwnership> {
  const policy = await loadRepositoryKnowledgePolicy(repositoryRoot);
  const taxonomy: DecisionTaxonomy | null = await loadDecisionTaxonomy(repositoryRoot).catch(
    () => null,
  );
  const roles = taxonomy?.documentPolicy.roles ?? [];
  return (path) =>
    documentFreshnessDocumentOwnership({
      documentPath: path,
      publicationRoot: policy.publicationRoot,
      roles,
    });
}

/**
 * Detection-side enrichment of the ADR-0464 outputs into freshness findings. It runs the drift
 * lint in `evaluate_and_record` mode, reads the recorded staleness projection, and adds Git and
 * reference facts. It writes only the rebuildable staleness projection that lint already owns.
 */
export async function observeDocumentFreshnessFindings(input: {
  repositoryRoot: string;
  now: Date;
  lint?: KnowledgeLintResult;
}): Promise<DocumentFreshnessObservation> {
  const root = resolve(input.repositoryRoot);
  let head: string;
  try {
    head = (await git(root, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  } catch {
    return {
      status: "unavailable",
      currentRevision: null,
      stalenessReportCurrent: false,
      findings: [],
      truncated: 0,
    };
  }
  const lint =
    input.lint ??
    (await lintRepositoryKnowledge(root, { documentStaleness: "evaluate_and_record" }));
  const report = await readRecordedDocumentStalenessReport(root);
  const reportCurrent =
    lint.coverage === "complete" &&
    report?.coverage === "complete" &&
    report.status === "observed" &&
    report.currentRevision === head;
  const sources = new Map<string, Set<DocumentFreshnessFindingSource>>();
  const add = (path: string, source: DocumentFreshnessFindingSource) =>
    sources.set(path, (sources.get(path) ?? new Set()).add(source));
  const staleness = new Map<string, DocumentStalenessFinding>();
  if (reportCurrent)
    for (const finding of report!.stale) {
      staleness.set(finding.path, finding);
      add(finding.path, "document_stale");
    }
  for (const issue of lint.issues) {
    const source = findingCodes.get(issue.code);
    if (source !== undefined) add(issue.path, source);
  }
  const policy = await loadRepositoryKnowledgePolicy(root);
  const taxonomy: DecisionTaxonomy | null = await loadDecisionTaxonomy(root).catch(() => null);
  const scopes = archiveScopes(taxonomy);
  const rolePaths = new Set((taxonomy?.documentPolicy.roles ?? []).map((role) => role.path));
  const oracle = filesystemDocumentFreshnessOracle(root);
  const successors = await supersededDocuments(root);
  // ADR-0473: a repository tool owns these bytes, so no refresh is ever proposed for them.
  const toolGenerated = await observeToolGeneratedDocuments({
    repositoryRoot: root,
    paths: [...sources.keys()],
    roles: taxonomy?.documentPolicy.roles ?? [],
  });
  const paths = [...sources.keys()].filter((path) => !toolGenerated.has(path)).sort();
  const findings: DocumentFreshnessFindingV1[] = [];
  for (const path of paths.slice(0, MAXIMUM_FINDINGS)) {
    const bytes = (() => {
      try {
        const stat = lstatSync(resolve(root, path));
        return stat.isFile() && stat.size <= MAXIMUM_TEXT_BYTES
          ? readFileSync(resolve(root, path))
          : null;
      } catch {
        return null;
      }
    })();
    if (bytes === null) continue;
    const content = bytes.toString("utf8");
    const references = documentFreshnessReferences({ path, content, oracle });
    const missingTargets = [
      ...new Set(references.filter((reference) => !reference.resolved).map((item) => item.target)),
    ].sort();
    const finding = documentFreshnessFinding({
      documentPath: path,
      documentHash: sha256(bytes),
      currentRevision: head,
      staleness: staleness.get(path) ?? null,
      sources: [...sources.get(path)!],
      connectedPathChanges: await connectedPathChanges({
        root,
        head,
        staleness: staleness.get(path),
        missingTargets,
      }),
      references,
      publicationGroup: documentFreshnessPublicationGroup({
        path,
        content,
        publicationRoot: policy.publicationRoot,
        archiveScopes: scopes,
        rolePaths,
      }),
      supersededBy: successors.get(path) ?? null,
      detectedAt: input.now.toISOString(),
    });
    if (finding.reasons.length > 0 && finding.publicationGroup !== "historical")
      findings.push(finding);
  }
  return {
    status: "observed",
    currentRevision: head,
    stalenessReportCurrent: reportCurrent,
    findings,
    truncated: Math.max(0, paths.length - MAXIMUM_FINDINGS),
  };
}
