import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  canonicalJson,
  documentFreshnessGenerationInstruction,
  documentFreshnessWritingContract,
  sha256,
  type DocumentFreshnessEvidenceItem,
  type DocumentFreshnessFindingV1,
} from "@lervo/repository-knowledge";

const execute = promisify(execFile);
const MAXIMUM_DIFF_BYTES = 16 * 1024;
const MAXIMUM_TOTAL_DIFF_BYTES = 64 * 1024;
const MAXIMUM_EXCERPT_LINES = 40;
const MAXIMUM_REPLACEMENTS = 8;
const MAXIMUM_RELATED_DOCUMENTS = 3;
const definitionPattern = (symbol: string) =>
  new RegExp(
    `\\b(?:class|def|function|interface|type|const|let|var|struct|enum|trait|fn)\\s+${symbol.replace(/[$.]/gu, "\\$&")}\\b`,
    "u",
  );

/**
 * The provider's only input (ADR-0463): the stale document, bounded evidence for every changed or
 * deleted connected path, at most three related documents, the writing contract, and the fixed
 * instruction. It never carries absolute paths, event history, or credentials.
 */
export interface FreshnessEvidenceBundleV1 {
  schemaVersion: 1;
  kind: "document_freshness.evidence_bundle";
  document: { path: string; hash: string; text: string };
  reasons: DocumentFreshnessFindingV1["reasons"];
  unresolvedReferences: Array<{ line: number; target: string; symbol: string | null }>;
  changedPaths: Array<{
    path: string;
    beforeHash: string | null;
    afterHash: string | null;
    disposition: string;
    renamedTo: string | null;
    diff: string | null;
    excerpts: string[];
  }>;
  deletedPaths: Array<{
    path: string;
    lastRevision: string | null;
    deletedInCommit: string | null;
    replacements: Array<{ path: string; hash: string; reason: string; excerpt: string }>;
  }>;
  relatedDocuments: Array<{ path: string; hash: string; excerpt: string }>;
  /** Every `{ path, hash }` a claim may cite. */
  evidence: Array<{ path: string; hash: string }>;
  evidenceTruncated: boolean;
  writingContract: { writingPolicyId: string; contractHash: string };
  instructions: string;
}

async function git(root: string, args: string[], maxBuffer = 4 * 1024 * 1024): Promise<string> {
  try {
    const { stdout } = await execute("git", ["--no-optional-locks", "-C", root, ...args], {
      encoding: "utf8",
      maxBuffer,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      timeout: 60_000,
      windowsHide: true,
    });
    return stdout;
  } catch {
    return "";
  }
}

async function blob(root: string, spec: string): Promise<Buffer | null> {
  try {
    const { stdout } = await execute("git", ["-C", root, "cat-file", "blob", spec], {
      encoding: "buffer",
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

function excerptAround(text: string, needles: readonly string[]): string[] {
  const lines = text.split(/\r?\n/u);
  const hits = lines.flatMap((line, index) =>
    needles.some((needle) => line.includes(needle)) ? [index] : [],
  );
  const selected = new Set<number>();
  for (const hit of hits)
    for (let index = Math.max(0, hit - 3); index <= Math.min(lines.length - 1, hit + 3); index += 1)
      if (selected.size < MAXIMUM_EXCERPT_LINES) selected.add(index);
  if (selected.size === 0)
    lines
      .slice(0, Math.min(MAXIMUM_EXCERPT_LINES, lines.length))
      .forEach((_, index) => selected.add(index));
  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => `${index + 1}: ${lines[index]}`);
}

async function symbolReplacements(
  root: string,
  symbols: readonly string[],
): Promise<Array<{ path: string; line: string }>> {
  const hits: Array<{ path: string; line: string }> = [];
  for (const symbol of symbols) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(symbol)) continue;
    const output = await git(root, ["grep", "-n", "-I", "-w", "-F", "-e", symbol, "HEAD", "--"]);
    const definition = definitionPattern(symbol);
    for (const raw of output.split("\n")) {
      const match = /^HEAD:([^:]+):(\d+):(.*)$/u.exec(raw);
      if (match === null || !definition.test(match[3]!)) continue;
      hits.push({ path: match[1]!, line: `${match[2]}: ${match[3]!.trim()}` });
      if (hits.length >= MAXIMUM_REPLACEMENTS) return hits;
    }
  }
  return hits;
}

async function basenameReplacements(root: string, path: string): Promise<string[]> {
  const name = path.split("/").at(-1)!;
  if (!/\.[A-Za-z0-9]{1,10}$/u.test(name)) return [];
  const output = await git(root, ["ls-files", "--", `*/${name}`, name]);
  return output
    .split("\n")
    .filter((candidate) => candidate !== "" && candidate !== path)
    .slice(0, MAXIMUM_REPLACEMENTS);
}

/**
 * Builds the bundle from committed bytes at the finding's revisions. The returned evidence items
 * carry the text factual tokens are matched against; the bundle itself goes to CAS before the call.
 */
export async function buildFreshnessEvidenceBundle(input: {
  repositoryRoot: string;
  finding: DocumentFreshnessFindingV1;
  content: Buffer;
}): Promise<{ bundle: FreshnessEvidenceBundleV1; evidence: DocumentFreshnessEvidenceItem[] }> {
  const root = input.repositoryRoot;
  const { finding } = input;
  const evidence = new Map<string, DocumentFreshnessEvidenceItem>();
  const addEvidence = (path: string, hash: string, text: string) => {
    const key = `${path}\0${hash}`;
    const existing = evidence.get(key);
    evidence.set(key, {
      path,
      hash,
      text: existing === undefined ? text : `${existing.text}\n${text}`,
    });
  };
  let diffBytes = 0;
  let truncated = false;
  const changedPaths: FreshnessEvidenceBundleV1["changedPaths"] = [];
  const deletedPaths: FreshnessEvidenceBundleV1["deletedPaths"] = [];
  const replacementPaths = new Set<string>();
  const symbolsByTarget = new Map<string, string[]>();
  for (const reference of finding.references)
    if (reference.symbol !== null)
      symbolsByTarget.set(reference.target, [
        ...(symbolsByTarget.get(reference.target) ?? []),
        reference.symbol,
      ]);
  for (const change of finding.connectedPathChanges) {
    const current = change.renamedTo ?? change.path;
    const currentBytes =
      change.disposition === "deleted" ? null : await blob(root, `HEAD:${current}`);
    if (
      change.disposition === "modified" ||
      change.disposition === "renamed" ||
      change.disposition === "added"
    ) {
      let diff: string | null = null;
      let excerpts: string[] = [];
      if (finding.verifiedRevision !== null) {
        const raw = await git(root, [
          "diff",
          "--no-color",
          "-M50%",
          "--unified=3",
          finding.verifiedRevision,
          finding.currentRevision,
          "--",
          change.path,
          ...(change.renamedTo === null ? [] : [change.renamedTo]),
        ]);
        if (
          Buffer.byteLength(raw) <= MAXIMUM_DIFF_BYTES &&
          diffBytes + Buffer.byteLength(raw) <= MAXIMUM_TOTAL_DIFF_BYTES
        ) {
          diff = raw;
          diffBytes += Buffer.byteLength(raw);
        } else truncated = true;
      }
      if (diff === null && currentBytes !== null)
        excerpts = excerptAround(currentBytes.toString("utf8"), [
          ...(symbolsByTarget.get(change.path) ?? []),
          ...(change.renamedTo === null ? [] : [change.renamedTo]),
        ]);
      changedPaths.push({ ...change, diff, excerpts });
      if (currentBytes !== null) {
        if (change.renamedTo !== null) replacementPaths.add(change.renamedTo);
        addEvidence(current, sha256(currentBytes), [current, diff ?? "", ...excerpts].join("\n"));
      }
      if (change.disposition !== "renamed") continue;
    }
    const deletedIn = (
      await git(root, [
        "log",
        "-1",
        "--first-parent",
        "--format=%H",
        "--diff-filter=D",
        "--",
        change.path,
      ])
    ).trim();
    const lastRevision = /^[a-f0-9]{40,64}$/u.test(deletedIn)
      ? `${deletedIn}^`
      : finding.verifiedRevision;
    const lastBytes =
      lastRevision === null ? null : await blob(root, `${lastRevision}:${change.path}`);
    addEvidence(
      change.path,
      lastBytes === null ? sha256(`deleted\0${change.path}\0${deletedIn}`) : sha256(lastBytes),
      `${change.path} no longer exists at ${finding.currentRevision}${deletedIn === "" ? "" : `; deleted in ${deletedIn}`}.`,
    );
    const replacements: FreshnessEvidenceBundleV1["deletedPaths"][number]["replacements"] = [];
    const symbols = symbolsByTarget.get(change.path) ?? [];
    // Each replacement carries a bounded excerpt of its current bytes, the text factual tokens
    // are matched against, around the symbols the document attached to the deleted path.
    const pushReplacement = async (path: string, reason: string) => {
      if (replacements.some((item) => item.path === path)) return;
      const bytes = await blob(root, `HEAD:${path}`);
      if (bytes === null) return;
      const hash = sha256(bytes);
      const excerpt = excerptAround(bytes.toString("utf8"), symbols).join("\n");
      replacements.push({ path, hash, reason, excerpt });
      replacementPaths.add(path);
      addEvidence(path, hash, `${path}\n${excerpt}`);
    };
    if (change.renamedTo !== null) await pushReplacement(change.renamedTo, "git_rename");
    for (const hit of await symbolReplacements(root, symbols))
      await pushReplacement(hit.path, "symbol_definition");
    for (const path of await basenameReplacements(root, change.path))
      await pushReplacement(path, "same_basename");
    deletedPaths.push({
      path: change.path,
      lastRevision,
      deletedInCommit: deletedIn === "" ? null : deletedIn,
      replacements: replacements.slice(0, MAXIMUM_REPLACEMENTS),
    });
  }
  const relatedDocuments: FreshnessEvidenceBundleV1["relatedDocuments"] = [];
  const addRelated = async (path: string, needles: readonly string[]) => {
    if (relatedDocuments.length >= MAXIMUM_RELATED_DOCUMENTS || path === finding.documentPath)
      return;
    if (relatedDocuments.some((item) => item.path === path)) return;
    const bytes = await blob(root, `HEAD:${path}`);
    if (bytes === null) return;
    const excerpt = excerptAround(bytes.toString("utf8"), needles).slice(0, 10).join("\n");
    const hash = sha256(bytes);
    relatedDocuments.push({ path, hash, excerpt });
    addEvidence(path, hash, `${path}\n${excerpt}`);
  };
  if (finding.supersededBy !== null) await addRelated(finding.supersededBy, [finding.documentPath]);
  for (const replacement of [...replacementPaths].sort()) {
    const output = await git(root, [
      "grep",
      "-l",
      "-I",
      "-F",
      "-e",
      replacement,
      "HEAD",
      "--",
      "*.md",
    ]);
    for (const line of output.split("\n").slice(0, 8))
      if (line.startsWith("HEAD:")) await addRelated(line.slice("HEAD:".length), [replacement]);
  }
  const documentHash = sha256(input.content);
  const items = [...evidence.values()].sort((left, right) =>
    left.path === right.path
      ? left.hash.localeCompare(right.hash)
      : left.path.localeCompare(right.path),
  );
  const bundle: FreshnessEvidenceBundleV1 = {
    schemaVersion: 1,
    kind: "document_freshness.evidence_bundle",
    document: {
      path: finding.documentPath,
      hash: documentHash,
      text: input.content.toString("utf8"),
    },
    reasons: finding.reasons,
    unresolvedReferences: finding.references
      .filter((reference) => !reference.resolved)
      .map((reference) => ({
        line: reference.line,
        target: reference.target,
        symbol: reference.symbol,
      })),
    changedPaths,
    deletedPaths,
    relatedDocuments,
    evidence: items.map((item) => ({ path: item.path, hash: item.hash })),
    evidenceTruncated: truncated,
    writingContract: documentFreshnessWritingContract(),
    instructions: documentFreshnessGenerationInstruction,
  };
  return { bundle, evidence: items };
}

export function freshnessBundleBytes(bundle: FreshnessEvidenceBundleV1): string {
  return canonicalJson(bundle);
}
