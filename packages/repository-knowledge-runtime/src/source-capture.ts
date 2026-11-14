import { execFileSync } from "node:child_process";
import { lstatSync } from "node:fs";

import {
  canonicalJson,
  recordSynchronousGitProcess,
  sha256,
  withProcessCostScope,
  type KnowledgeConvergenceBaseline,
} from "@lervo/repository-knowledge";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import {
  convergenceSourceCaptureSettings,
  type ConvergenceSourceCaptureSettings,
} from "./source-capture-settings.js";
import {
  MAXIMUM_ORDINARY_SOURCE_BYTES,
  ordinaryConvergenceSourceBytes,
  ordinaryConvergenceSourcePath,
  readOrdinaryConvergenceSource,
} from "./source-file.js";
import {
  openSourceHashCache,
  type CachedSourceHash,
  type SourceHashCache,
} from "./source-hash-cache.js";
import {
  symbolicConvergenceSourceBytes,
  assertSymbolicTargetsCaptured,
  repositoryLinkReference,
} from "./symbolic-source.js";
import { CONVERGENCE_DELEGATION_PATH } from "./delegation-contract.js";

const GENERATED = [".lervo/state/", ".lervo/data/", ".lervo/generated/", "docs/knowledge/"];
export function convergenceSourcePath(path: string): boolean {
  return !GENERATED.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}
export function convergenceSourceBytes(
  root: string,
  path: string,
  settings = convergenceSourceCaptureSettings(root),
): Buffer {
  const reference = settings.policy.symbolicReferences.find((item) => item.path === path);
  return reference
    ? symbolicConvergenceSourceBytes(root, reference)
    : ordinaryConvergenceSourceBytes(root, path);
}

function git(root: string, args: string[]): string {
  recordSynchronousGitProcess(args);
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_unavailable", {
      cause: error,
    });
  }
}

function classifiedSource(bytes: Buffer): CachedSourceHash {
  let kind: "text" | "opaque" = "opaque";
  if (bytes.byteLength <= 256 * 1024) {
    try {
      if (!new TextDecoder("utf8", { fatal: true }).decode(bytes).includes("\0")) kind = "text";
    } catch {
      /* Opaque bytes stay out of text review. */
    }
  }
  return { contentHash: sha256(bytes), kind };
}

/** Exact metadata may reuse a non-racy hash; every other source is read through the same checks. */
function observeConvergenceSource(
  root: string,
  path: string,
  settings: ConvergenceSourceCaptureSettings,
  cache: SourceHashCache,
  derivedReferences: ConvergenceSourceCaptureSettings["policy"]["symbolicReferences"],
): CachedSourceHash & { byteLength: number } {
  // A reviewed reference wins; an undeclared in-repository link is captured the same way.
  const declared = settings.policy.symbolicReferences.find((item) => item.path === path);
  const reference = declared ?? repositoryLinkReference(root, path);
  if (reference) {
    if (declared === undefined) derivedReferences.push(reference);
    const bytes = symbolicConvergenceSourceBytes(root, reference);
    return { ...classifiedSource(bytes), byteLength: bytes.byteLength };
  }
  const stat = lstatSync(ordinaryConvergenceSourcePath(root, path), { bigint: true });
  if (stat.isFile() && stat.size <= BigInt(MAXIMUM_ORDINARY_SOURCE_BYTES)) {
    const cached = cache.lookup(path, stat);
    if (cached !== null) return { ...cached, byteLength: Number(stat.size) };
  }
  const hashedAtNs = BigInt(Date.now()) * 1_000_000n;
  const { bytes, stat: read } = readOrdinaryConvergenceSource(root, path);
  const observed = classifiedSource(bytes);
  if (BigInt(bytes.byteLength) === read.size) cache.record(path, read, hashedAtNs, observed);
  return { ...observed, byteLength: bytes.byteLength };
}

/** Current working-tree obligations; the complete capture still fences every repository source. */
export function captureConvergenceChangedPaths(root: string): string[] {
  return [
    ...new Set(
      [
        git(root, ["diff", "--name-only", "-z", "--diff-filter=ACMRTUXB", "HEAD"]),
        git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
      ]
        .flatMap((output) => output.split("\0"))
        .filter((path) => path.length > 0 && convergenceSourcePath(path)),
    ),
  ].sort();
}

export interface ConvergenceSourceCapture {
  head: string;
  snapshotId: string;
  snapshotHash: string;
  sources: KnowledgeConvergenceBaseline["sources"];
}

/** Git ignore evidence excludes only untracked paths; tracked opaque assets remain in the capture. */
export function captureConvergenceSources(
  root: string,
  policyHash: string,
): ConvergenceSourceCapture {
  return captureConvergenceSourcesWithChangedPaths(root, policyHash).capture;
}

/**
 * The capture together with the closing changed-path observation its snapshot hash binds, so a
 * caller that needs both reads them from one closing observation instead of listing twice.
 */
export function captureConvergenceSourcesWithChangedPaths(
  root: string,
  policyHash: string,
): { capture: ConvergenceSourceCapture; changedPaths: string[] } {
  return withProcessCostScope("capture", () => captureSourcesAndChangedPaths(root, policyHash));
}

function captureSourcesAndChangedPaths(
  root: string,
  policyHash: string,
): { capture: ConvergenceSourceCapture; changedPaths: string[] } {
  const settings: ConvergenceSourceCaptureSettings = convergenceSourceCaptureSettings(root);
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  const paths = [
    ...new Set(
      git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        .split("\0")
        .filter((path) => path.length > 0 && convergenceSourcePath(path)),
    ),
  ].sort();
  if (paths.length > 20_000)
    throw new KnowledgeConvergenceRuntimeError("knowledge_source_limit_exceeded");
  const sources: KnowledgeConvergenceBaseline["sources"] = [];
  let totalBytes = 0;
  const cache = openSourceHashCache(root);
  const derivedReferences: ConvergenceSourceCaptureSettings["policy"]["symbolicReferences"] = [];
  try {
    for (const path of paths) {
      let observed: CachedSourceHash & { byteLength: number };
      try {
        observed = observeConvergenceSource(root, path, settings, cache, derivedReferences);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      totalBytes += observed.byteLength;
      if (totalBytes > settings.policy.maximumRepositoryBytes)
        throw new KnowledgeConvergenceRuntimeError("knowledge_source_limit_exceeded");
      sources.push({ path, contentHash: observed.contentHash, kind: observed.kind });
    }
    cache.commit(new Set(sources.map((source) => source.path)));
  } finally {
    cache.close();
  }
  assertSymbolicTargetsCaptured(
    [...settings.policy.symbolicReferences, ...derivedReferences],
    sources.map((source) => source.path),
  );
  if (
    settings.delegationContentHash !== null &&
    sha256(ordinaryConvergenceSourceBytes(root, CONVERGENCE_DELEGATION_PATH, 64 * 1024)) !==
      settings.delegationContentHash
  )
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  if (git(root, ["rev-parse", "HEAD"]).trim() !== head)
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  const changedPaths = captureConvergenceChangedPaths(root);
  const snapshotHash = sha256(canonicalJson({ head, policyHash, sources, changedPaths }));
  return {
    capture: { head, snapshotId: `ksnap_${snapshotHash.slice(7, 31)}`, snapshotHash, sources },
    changedPaths,
  };
}
