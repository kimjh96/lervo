import { canonicalHash } from "@lervo/search";
import type { InstructionPreparationReport } from "@lervo/schemas";
import type { InstructionSource } from "./instruction-sources.js";

/** One packed owner rule: its path, its content hash, and its exact section bytes in `context`. */
export interface PackedInstructionSection {
  path: string;
  contentHash: string;
  text: string;
}

/** Pack complete canonical clauses, including all conditions and exceptions, or report omission. */
export function packInstructionSources(input: {
  sources: readonly InstructionSource[];
  targetDigest: string;
  maximumBytes: number;
}): {
  context: string;
  report: InstructionPreparationReport;
  preparedPaths: string[];
  /** The packed sections in order; `context` is exactly their texts joined by blank lines. */
  sections: PackedInstructionSection[];
} {
  if (
    !Number.isSafeInteger(input.maximumBytes) ||
    input.maximumBytes < 0 ||
    input.maximumBytes > 1048576 ||
    input.sources.length > 64
  )
    throw new TypeError("Instruction preparation bounds are invalid.");
  const sources = [...input.sources].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const applicable = sources.filter((s) => s.applicability === "applicable");
  const unresolved = sources.filter(
    (s) => s.applicability === "unresolved" || s.applicability === "conflict",
  );
  const admitted = [...applicable, ...unresolved];
  const parts: string[] = [];
  let bytes = 0;
  const preparedPaths: string[] = [];
  const sections: PackedInstructionSection[] = [];
  for (const source of admitted) {
    const section = `Lervo applied owner rule (${source.applicability}; ${source.path}; ${source.contentHash}):\n${source.content}`;
    const next = Buffer.byteLength(section) + (parts.length > 0 ? 2 : 0);
    if (bytes + next > input.maximumBytes) continue;
    parts.push(section);
    preparedPaths.push(source.path);
    sections.push({ path: source.path, contentHash: source.contentHash, text: section });
    bytes += next;
  }
  const omitted = admitted.length - parts.length;
  const reasons: InstructionPreparationReport["reasonCodes"] = [];
  if (unresolved.length > 0) reasons.push("instruction_scope_unresolved");
  if (omitted > 0) reasons.push("instruction_capacity_insufficient");
  return {
    context: parts.join("\n\n"),
    preparedPaths,
    sections,
    report: {
      schemaVersion: 1,
      scope: "applied_owner_rules",
      status: reasons.length === 0 ? "complete" : "incomplete",
      catalogDigest: canonicalHash(sources.map(({ content: _content, ...source }) => source)),
      targetDigest: input.targetDigest,
      observedCount: sources.length,
      applicableCount: applicable.length,
      excludedCount: sources.length - admitted.length,
      unresolvedCount: unresolved.length,
      preparedCount: parts.length,
      omittedCount: omitted,
      preparedByteCount: bytes,
      reasonCodes: reasons,
      delivery: "unobserved",
    },
  };
}
