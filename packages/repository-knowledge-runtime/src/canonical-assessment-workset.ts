import { sha256 } from "@lervo/repository-knowledge";
import type { CanonicalAssessmentSource } from "./canonical-assessment-contract.js";
import type { ConvergenceDelegation } from "./delegation.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { convergenceSourceBytes } from "./source-capture.js";

/** Prepare one contiguous, exact source workset within the reviewed count and byte ceilings. */
export function prepareCanonicalAssessmentSources(input: {
  repositoryRoot: string;
  sources: readonly CanonicalAssessmentSource[];
  offset: number;
  ceilings: ConvergenceDelegation["resourceCeilings"];
}): CanonicalAssessmentSource[] {
  const selected: CanonicalAssessmentSource[] = [];
  const maximumBytes = Math.min(512 * 1024, input.ceilings.maximumSourceBytes);
  let byteCount = 0;
  for (const source of input.sources.slice(input.offset)) {
    if (selected.length >= input.ceilings.maximumDocuments) break;
    const bytes = convergenceSourceBytes(input.repositoryRoot, source.path);
    if (byteCount + bytes.byteLength > maximumBytes) break;
    if (sha256(bytes) !== source.contentHash)
      throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
    selected.push({
      ...source,
      ...(source.kind === "text"
        ? { content: new TextDecoder("utf8", { fatal: true }).decode(bytes) }
        : {}),
    });
    byteCount += bytes.byteLength;
  }
  if (!selected.length && input.offset < input.sources.length)
    throw new KnowledgeConvergenceRuntimeError("knowledge_source_limit_exceeded");
  return selected;
}
