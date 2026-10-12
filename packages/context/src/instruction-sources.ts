import {
  readInstructionConditions,
  resolveInstructionConditions,
  type InstructionConditions,
  type InstructionTargets,
} from "./instruction-conditions.js";
import { createHash } from "node:crypto";
import { lstat, opendir, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { readRepositoryFile, repositoryFileExists } from "./filesystem.js";
import { compareCanonicalText } from "./paths.js";
import { resolveInstructionScope, type InstructionApplicability } from "./instruction-scope.js";
import { ContextPreparationError } from "./types.js";

export const GENERATED_INSTRUCTION_DIRECTORY = "docs/instructions/generated";
const RULE_FILE = /^rule_[a-f0-9]{24}\.md$/u;
const MAXIMUM_RULES = 64;

export interface InstructionSource {
  path: string;
  contentHash: string;
  content: string;
  paths: string[];
  applicability: InstructionApplicability;
  conditions?: InstructionConditions;
}

export function isGeneratedInstructionPath(path: string): boolean {
  const prefix = `${GENERATED_INSTRUCTION_DIRECTORY}/`;
  return path.startsWith(prefix) && RULE_FILE.test(path.slice(prefix.length));
}

/** Enumerate every admitted rule or fail explicitly; never silently take the first N. */
export async function generatedInstructionPaths(root: string): Promise<string[]> {
  // Inspect every parent using the same no-symlink contract as source reads.
  await repositoryFileExists(root, `${GENERATED_INSTRUCTION_DIRECTORY}/.lervo-inspection`);
  const directory = resolve(root, GENERATED_INSTRUCTION_DIRECTORY);
  let before;
  try {
    before = await lstat(directory, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!before.isDirectory() || before.isSymbolicLink())
    throw new ContextPreparationError(
      "unsafe_document_path",
      "Instruction directory must be a real directory.",
    );
  const canonical = await realpath(directory);
  const paths: string[] = [];
  let entries = 0;
  for await (const entry of await opendir(directory)) {
    entries += 1;
    if (entries > 4096 || (RULE_FILE.test(entry.name) && paths.length === MAXIMUM_RULES))
      throw new ContextPreparationError(
        "instruction_catalog_overflow",
        "Instruction catalog exceeds its supported capacity.",
      );
    if (RULE_FILE.test(entry.name)) paths.push(`${GENERATED_INSTRUCTION_DIRECTORY}/${entry.name}`);
  }
  const after = await lstat(directory, { bigint: true });
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs ||
    after.isSymbolicLink() ||
    canonical !== (await realpath(directory))
  )
    throw new ContextPreparationError(
      "document_changed_during_read",
      "Instruction directory changed during discovery.",
    );
  return paths.sort(compareCanonicalText);
}

export async function readInstructionSource(
  root: string,
  path: string,
  expectedPaths: readonly string[] | null,
  targets: InstructionTargets = {},
): Promise<InstructionSource> {
  const bytes = await readRepositoryFile(root, path, 131072);
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    throw new ContextPreparationError(
      "required_rule_unresolved",
      "Instruction source is not valid UTF-8.",
      { cause: error },
    );
  }
  if (!content.trim() && isGeneratedInstructionPath(path))
    throw new ContextPreparationError("required_rule_unresolved", "Instruction source is empty.");
  const scope = resolveInstructionScope(content, expectedPaths);
  const conditions = readInstructionConditions(content);
  return {
    path,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    content,
    paths: scope.paths,
    applicability: resolveInstructionConditions(
      scope.applicability,
      conditions,
      expectedPaths,
      targets,
    ),
    ...(conditions === undefined ? {} : { conditions }),
  };
}
