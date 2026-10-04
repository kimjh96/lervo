import { execFileSync } from "node:child_process";

import {
  canonicalJson,
  sha256,
  type KnowledgeConvergenceBaseline,
} from "@lervo/repository-knowledge";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import {
  convergenceSourceCaptureSettings,
  type ConvergenceSourceCaptureSettings,
} from "./source-capture-settings.js";
import { ordinaryConvergenceSourceBytes } from "./source-file.js";
import {
  symbolicConvergenceSourceBytes,
  assertSymbolicTargetsCaptured,
} from "./symbolic-source.js";
import { CONVERGENCE_DELEGATION_PATH } from "./delegation-contract.js";

const GENERATED = [".lervo/state/", ".lervo/data/", ".lervo/generated/", "docs/knowledge/"];
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

/** Current working-tree obligations; the complete capture still fences every repository source. */
export function captureConvergenceChangedPaths(root: string): string[] {
  return [
    ...new Set(
      [
        git(root, ["diff", "--name-only", "-z", "--diff-filter=ACMRTUXB", "HEAD"]),
        git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
      ]
        .flatMap((output) => output.split("\0"))
        .filter(Boolean),
    ),
  ].sort();
}

/** Git ignore evidence excludes only untracked paths; tracked opaque assets remain in the capture. */
export function captureConvergenceSources(
  root: string,
  policyHash: string,
): {
  head: string;
  snapshotId: string;
  snapshotHash: string;
  sources: KnowledgeConvergenceBaseline["sources"];
} {
  const settings: ConvergenceSourceCaptureSettings = convergenceSourceCaptureSettings(root);
  const head = git(root, ["rev-parse", "HEAD"]).trim();
  const paths = [
    ...new Set(
      git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
        .split("\0")
        .filter((path) => path.length > 0 && !GENERATED.some((prefix) => path.startsWith(prefix))),
    ),
  ].sort();
  if (paths.length > 20_000)
    throw new KnowledgeConvergenceRuntimeError("knowledge_source_limit_exceeded");
  const sources: KnowledgeConvergenceBaseline["sources"] = [];
  let totalBytes = 0;
  for (const path of paths) {
    let bytes: Buffer;
    try {
      bytes = convergenceSourceBytes(root, path, settings);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > settings.policy.maximumRepositoryBytes)
      throw new KnowledgeConvergenceRuntimeError("knowledge_source_limit_exceeded");
    let kind: "text" | "opaque" = "opaque";
    if (bytes.byteLength <= 256 * 1024) {
      try {
        if (!new TextDecoder("utf8", { fatal: true }).decode(bytes).includes("\0")) kind = "text";
      } catch {
        /* Opaque bytes stay out of text review. */
      }
    }
    sources.push({ path, contentHash: sha256(bytes), kind });
  }
  assertSymbolicTargetsCaptured(
    settings.policy.symbolicReferences,
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
  return { head, snapshotId: `ksnap_${snapshotHash.slice(7, 31)}`, snapshotHash, sources };
}
