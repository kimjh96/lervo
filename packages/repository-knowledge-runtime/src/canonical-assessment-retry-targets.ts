import { sha256 } from "@lervo/repository-knowledge";

import { pathWithinConvergenceRoots } from "./delegation.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { convergenceSourceBytes, type captureConvergenceSources } from "./source-capture.js";

type CapturedSource = ReturnType<typeof captureConvergenceSources>["sources"][number];

/** Supply exact permitted target preimages for one bounded fresh assessment. */
export function loadAssessmentRetryTargets(input: {
  repositoryRoot: string;
  response: unknown;
  capturedSources: readonly CapturedSource[];
  canonicalRoots: readonly string[];
}): { path: string; contentHash: string; content: string | null }[] {
  const drafts = (input.response as { drafts?: unknown } | null)?.drafts;
  const captured = new Map(input.capturedSources.map((source) => [source.path, source]));
  const targets: { path: string; contentHash: string; content: string | null }[] = [];
  let remainingContentBytes = 64 * 1024;
  for (const draft of (Array.isArray(drafts) ? drafts : []).slice(0, 8)) {
    const path = (draft as { path?: unknown } | null)?.path;
    if (typeof path !== "string" || !pathWithinConvergenceRoots(path, input.canonicalRoots))
      continue;
    const source = captured.get(path);
    if (!source || targets.some((target) => target.path === path)) continue;
    const bytes = convergenceSourceBytes(input.repositoryRoot, source.path);
    if (sha256(bytes) !== source.contentHash)
      throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
    const includeContent = source.kind === "text" && bytes.byteLength <= remainingContentBytes;
    if (includeContent) remainingContentBytes -= bytes.byteLength;
    targets.push({
      path: source.path,
      contentHash: source.contentHash,
      content: includeContent ? new TextDecoder("utf8", { fatal: true }).decode(bytes) : null,
    });
  }
  return targets;
}
