import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  extractRelationDocument,
  relationSuspectsFor,
  relationWebStats,
} from "@lervo/repository-knowledge";

import { cliCommandCatalog } from "./cli-command-catalog.js";
import { writeCommandError } from "./command-error-output.js";
import {
  formatRelationWebStats,
  formatRelationWebSuspects,
  relationWebRefreshSummary,
} from "./knowledge-web-format.js";
import { relationChangeSince } from "./relation-web-change.js";
import { refreshRelationWeb } from "./relation-web-projection.js";
import type { CliIo } from "./types.js";

/**
 * `lervo knowledge web stats|suspects` (ADR-0562): refreshes the private relation web, then prints
 * its measures or the documents a change since a revision may have made wrong. It changes no
 * repository bytes. A stale web is reported with `relation_web_stale` and exit status 1.
 */
export async function runKnowledgeWeb(args: string[], io: CliIo): Promise<number> {
  let json = args.includes("--json");
  try {
    const action = args[0];
    if (action !== "stats" && action !== "suspects")
      throw new Error("Knowledge web requires stats or suspects.");
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: { root: { type: "string" }, since: { type: "string" }, json: { type: "boolean" } },
    });
    json = parsed.values.json === true;
    const since = parsed.values.since;
    if (action === "suspects" && since === undefined)
      throw new Error("Knowledge web suspects requires --since <revision>.");
    const root = resolve(io.cwd, parsed.values.root ?? ".");
    // The usage text lives in the entrypoint, which is fully loaded once a command runs.
    const { cliUsage } = await import("./main.js");
    const refresh = await refreshRelationWeb(root, {
      commands: cliCommandCatalog(cliUsage),
      now: new Date(),
    });
    const status = refresh.status === "current" ? 0 : 1;
    const write = (value: unknown, text: string) =>
      io.stdout(json ? `${JSON.stringify(value, null, 2)}\n` : text);
    if (refresh.web === null) {
      write(
        { refresh: relationWebRefreshSummary(refresh) },
        "Relation web: stale (relation_web_stale) with no previous web\n",
      );
      return 1;
    }
    if (action === "stats") {
      const stats = relationWebStats(refresh.web);
      write(
        { refresh: relationWebRefreshSummary(refresh), stats },
        formatRelationWebStats(refresh, stats),
      );
      return status;
    }
    const change = await relationChangeSince(root, since!);
    const result = relationSuspectsFor(refresh.web, {
      ...change,
      previousExtractions: new Map(
        [...change.previousDocuments].map(([path, content]) => [
          path,
          extractRelationDocument({ path, content, observedRevision: since! }),
        ]),
      ),
    });
    write(
      {
        refresh: relationWebRefreshSummary(refresh),
        since,
        changedPathCount: change.changedPaths.length,
        deletedPathCount: change.deletedPaths.length,
        // The catalog at `since` is unknown, so command removals are not compared.
        commandsCompared: false,
        ...result,
      },
      formatRelationWebSuspects(refresh, since!, result),
    );
    return status;
  } catch (error) {
    writeCommandError(io, error, { json });
    return 1;
  }
}
