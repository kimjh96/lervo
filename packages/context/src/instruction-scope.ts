import { matchesGlob } from "node:path";
import { parse } from "yaml";
import { canonicalHash } from "@lervo/search";

import { normalizeRepositoryPath } from "./paths.js";
import { ContextPreparationError } from "./types.js";

export function instructionScopeError(error: unknown): ContextPreparationError {
  return new ContextPreparationError(
    "required_rule_unresolved",
    "Instruction scope metadata is invalid.",
    {
      cause: {
        code: "instruction_scope_invalid",
        causeDigest: canonicalHash(
          error instanceof Error
            ? { name: error.name, message: error.message }
            : { kind: typeof error },
        ),
      },
    },
  );
}

export type InstructionApplicability = "applicable" | "not_applicable" | "unresolved" | "conflict";

/** Scope comes from canonical instruction metadata, never retrieval keywords or titles. */
export function resolveInstructionScope(
  content: string,
  expectedPaths: readonly string[] | null,
): { paths: string[]; applicability: InstructionApplicability } {
  const metadataContent = content.startsWith("\uFEFF") ? content.slice(1) : content;
  let paths: string[] = [];
  if (/^---\r?\n/u.test(metadataContent)) {
    const start = metadataContent.indexOf("\n") + 1;
    const match = /\r?\n---(?:\r?\n|$)/u.exec(metadataContent.slice(start));
    if (match === null || match.index > 8192)
      throw new ContextPreparationError(
        "required_rule_unresolved",
        "Instruction scope metadata is incomplete.",
      );
    let value: unknown;
    try {
      value = parse(metadataContent.slice(start, start + match.index), { maxAliasCount: 0 });
    } catch (error) {
      throw instructionScopeError(error);
    }
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new ContextPreparationError(
        "required_rule_unresolved",
        "Instruction scope metadata must be an object.",
      );
    if ("globs" in value)
      throw new ContextPreparationError(
        "required_rule_unresolved",
        "Instruction scope requires canonical paths metadata.",
      );
    const raw = (value as Record<string, unknown>).paths;
    if (raw !== undefined) {
      if (
        !Array.isArray(raw) ||
        raw.length === 0 ||
        raw.length > 64 ||
        raw.some((path) => typeof path !== "string" || path.length > 1024)
      )
        throw new ContextPreparationError(
          "required_rule_unresolved",
          "Instruction paths must be a bounded nonempty list.",
        );
      try {
        paths = [...new Set((raw as string[]).map(normalizeRepositoryPath))].sort();
      } catch (error) {
        throw instructionScopeError(error);
      }
    }
  }
  if (paths.length === 0) return { paths, applicability: "applicable" };
  if (expectedPaths === null || expectedPaths.length === 0)
    return { paths, applicability: "unresolved" };
  const targets = expectedPaths.map(normalizeRepositoryPath);
  return {
    paths,
    applicability: paths.some((pattern) =>
      targets.some(
        (target) =>
          target === pattern || target.startsWith(`${pattern}/`) || matchesGlob(target, pattern),
      ),
    )
      ? "applicable"
      : "not_applicable",
  };
}
