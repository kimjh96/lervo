import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { writeCommandError } from "./command-error-output.js";
import { revertKnowledgeEffect } from "./knowledge-effect-revert.js";
import type { CliIo } from "./types.js";

/** `lervo knowledge revert <commit>`: the one undo command for a cross-checked effect (ADR-0561). */
export async function runKnowledgeRevert(args: string[], io: CliIo): Promise<number> {
  let json = false;
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: { root: { type: "string" }, json: { type: "boolean" } },
    });
    json = parsed.values.json === true;
    if (parsed.positionals.length !== 1)
      throw new Error("Knowledge revert requires exactly one effect commit.");
    const result = await revertKnowledgeEffect({
      repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
      commit: parsed.positionals[0]!,
      now: new Date(),
    });
    io.stdout(
      json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Reverted the ${result.effect} effect of ${result.revertedCommit} (${result.paths.length} paths).\n${result.heldMoves > 0 ? `Lervo keeps ${result.heldMoves} documents in place until their bytes change.\n` : ""}${result.commit === null ? "Commit the restored paths with the current change.\n" : `commit: ${result.commit}\n`}`,
    );
    return 0;
  } catch (error) {
    writeCommandError(io, error, { json });
    return 1;
  }
}
