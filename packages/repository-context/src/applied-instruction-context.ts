import {
  ContextPreparationError,
  type PackedInstructionSection,
  generatedInstructionPaths,
  normalizeRepositoryPath,
  packInstructionSources,
  readInstructionSource,
  resolveInstructionPrecedence,
  type InstructionTargets,
} from "@lervo/context";
import { canonicalHash } from "@lervo/search";
import type { InstructionPreparationReport } from "@lervo/schemas";

/** Fresh bounded owner-rule reads; no full repository scan, model, or task-text authority inference. */
export async function prepareAppliedInstructionContext(input: {
  repositoryRoot: string;
  expectedPaths: readonly string[] | null;
  maximumBytes: number;
  targets?: InstructionTargets;
}): Promise<{
  context: string;
  report: InstructionPreparationReport;
  preparedPaths: string[];
  sections: PackedInstructionSection[];
}> {
  const targets =
    input.expectedPaths === null || input.expectedPaths.length === 0
      ? null
      : [...new Set(input.expectedPaths.map(normalizeRepositoryPath))].sort();
  const targetDigest = canonicalHash({ paths: targets, ...input.targets });
  try {
    const paths = await generatedInstructionPaths(input.repositoryRoot);
    // Reads run together; each prompt prepares these, and one at a time they added up.
    const sources = await Promise.all(
      paths.map((path) =>
        readInstructionSource(input.repositoryRoot, path, targets, input.targets),
      ),
    );
    const result = packInstructionSources({
      sources: resolveInstructionPrecedence(sources),
      targetDigest,
      maximumBytes: input.maximumBytes,
    });
    // Bind both membership and exact bytes again before exposing the prepared clauses.
    if (
      canonicalHash(await generatedInstructionPaths(input.repositoryRoot)) !== canonicalHash(paths)
    )
      throw new ContextPreparationError(
        "document_changed_during_read",
        "Instruction membership changed.",
      );
    const current = await Promise.all(
      sources.map((source) =>
        readInstructionSource(input.repositoryRoot, source.path, targets, input.targets),
      ),
    );
    if (current.some((reread, index) => reread.contentHash !== sources[index]!.contentHash))
      throw new ContextPreparationError(
        "document_changed_during_read",
        "Instruction source changed.",
      );
    return result;
  } catch (error) {
    return {
      context: "",
      preparedPaths: [],
      sections: [],
      report: {
        schemaVersion: 1,
        scope: "applied_owner_rules",
        status: "unavailable",
        catalogDigest: null,
        targetDigest,
        observedCount: null,
        applicableCount: null,
        excludedCount: null,
        unresolvedCount: null,
        preparedCount: 0,
        omittedCount: null,
        preparedByteCount: 0,
        reasonCodes: [
          error instanceof ContextPreparationError
            ? error.code === "document_changed_during_read"
              ? "instruction_source_changed"
              : error.code === "instruction_catalog_overflow"
                ? "instruction_catalog_overflow"
                : error.code === "required_rule_unresolved" ||
                    error.code === "invalid_expected_path"
                  ? "instruction_scope_invalid"
                  : error.code === "unsafe_document_path"
                    ? "instruction_source_unsafe"
                    : "instruction_source_unavailable"
            : "instruction_source_unavailable",
        ],
        delivery: "unobserved",
      },
    };
  }
}
