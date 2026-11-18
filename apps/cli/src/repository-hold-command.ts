import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  holdRepository,
  readRepositoryHolds,
  releaseRepositoryHold,
  type RepositoryHold,
} from "@lervo/repository-registry";

import { writeCommandError } from "./command-error-output.js";
import { releaseOwnerHeldEffects } from "./held-effect-debt.js";
import type { CliIo } from "./types.js";

export const repositoryHoldUsage = [
  "  lervo repository hold --root <path> [--reason <text>] [--json]",
  "  lervo repository release --root <path> [--json]",
  "  lervo repository holds [--json]",
].join("\n");

function holdLine(hold: RepositoryHold): string {
  return `${hold.repositoryRoot} held since ${hold.heldAt}${hold.reason === null ? "" : ` (${hold.reason})`}`;
}

/**
 * ADR-0561: the owner defers one repository. While it is held, the release follower skips its
 * upgrade, the background resident applies nothing there, and replica conflicts stay open; plans
 * and notices continue. `release` also clears the owner's effect holds there, such as a provider
 * hook merge the owner undid with `lervo state restore`.
 */
export async function runRepositoryHoldCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        reason: { type: "string" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(
      `${error instanceof Error ? error.message : String(error)}\n${repositoryHoldUsage}\n`,
    );
    return 1;
  }
  const action = parsed.positionals[0];
  const json = parsed.values.json === true;
  try {
    if (parsed.positionals.length !== 1 || !["hold", "release", "holds"].includes(action ?? ""))
      throw new Error(`Specify repository hold, release, or holds.\n${repositoryHoldUsage}`);
    if (action === "holds") {
      const holds = await readRepositoryHolds();
      io.stdout(
        json
          ? `${JSON.stringify({ schemaVersion: 1, holds }, null, 2)}\n`
          : holds.length === 0
            ? "No repository is held.\n"
            : `${holds.map(holdLine).join("\n")}\n`,
      );
      return 0;
    }
    if (parsed.values.root === undefined) throw new Error("--root is required.");
    if (action === "release" && parsed.values.reason !== undefined)
      throw new Error("--reason applies only to repository hold.");
    const repositoryRoot = resolve(io.cwd, parsed.values.root);
    if (action === "hold") {
      const hold = await holdRepository({
        repositoryRoot,
        ...(parsed.values.reason === undefined ? {} : { reason: parsed.values.reason }),
      });
      io.stdout(
        json
          ? `${JSON.stringify({ schemaVersion: 1, operation: "repository_held", hold }, null, 2)}\n`
          : `Held ${holdLine(hold)}.\nLervo applies nothing here on its own until lervo repository release --root ${hold.repositoryRoot}.\n`,
      );
      return 0;
    }
    const released = await releaseRepositoryHold({ repositoryRoot });
    const effects = await releaseOwnerHeldEffects(repositoryRoot).catch(() => 0);
    io.stdout(
      json
        ? `${JSON.stringify({ schemaVersion: 1, operation: "repository_released", released, releasedEffectHolds: effects }, null, 2)}\n`
        : `${released === null ? `${repositoryRoot} was not held.` : `Released ${holdLine(released)}.`}${effects === 0 ? "" : ` Released ${effects} owner effect hold${effects === 1 ? "" : "s"}.`}\n`,
    );
    return 0;
  } catch (error) {
    writeCommandError(io, error, { json, prefix: "Repository hold failed: " });
    return 1;
  }
}
