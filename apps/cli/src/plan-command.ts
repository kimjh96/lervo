import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { openProjectStorage } from "@lervo/project-storage";
import {
  formatPlanLedgerLines,
  planLedgerLines,
  type PlanItem,
  type PlanItemEvidence,
  type PlanItemKind,
} from "@lervo/repository-knowledge";
import {
  capturePlanItem,
  closePlanItem,
  readPlanLedger,
  updatePlanItem,
} from "@lervo/repository-knowledge-runtime";

import { writeCommandError } from "./command-error-output.js";
import type { CliIo } from "./types.js";
import { resolveCommandRoots } from "./terminal-roots.js";

export const planUsage = [
  "  lervo plan list [--all] [--root <path>] [--json]",
  "  lervo plan add --title <paraphrase> [--parent <item-id>] [--kind <objective|directive|plan|finding>] [--root <path>] [--json]",
  "  lervo plan start <item-id> [--root <path>] [--json]",
  "  lervo plan move <item-id> (--parent <item-id> | --root-level) [--root <path>] [--json]",
  "  lervo plan done <item-id> --reason <paraphrase> (--commit <sha> [--branch <ref>] | --release <tag> | --event <event-id>)... [--root <path>] [--json]",
  "  lervo plan cancel <item-id> --reason <paraphrase> [--root <path>] [--json]",
  "  lervo plan supersede <item-id> --by <item-id> --reason <paraphrase> [--root <path>] [--json]",
].join("\n");

const KINDS = new Set<PlanItemKind>(["objective", "directive", "plan", "finding"]);
const ACTIONS = new Set(["list", "add", "start", "move", "done", "cancel", "supersede"]);

function itemJson(item: PlanItem) {
  return { ...item };
}

/**
 * ADR-0563: the agent-facing surface of the plan ledger. Items an agent adds here are kept as a
 * tree by Lervo, never dropped for space, and close as done only with evidence Lervo verifies.
 */
export async function runPlanCommand(args: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        title: { type: "string" },
        parent: { type: "string" },
        kind: { type: "string" },
        reason: { type: "string" },
        by: { type: "string" },
        commit: { type: "string", multiple: true },
        branch: { type: "string" },
        release: { type: "string", multiple: true },
        event: { type: "string", multiple: true },
        "root-level": { type: "boolean" },
        all: { type: "boolean" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${planUsage}\n`);
    return 1;
  }
  const [action, itemId] = parsed.positionals;
  const values = parsed.values;
  const json = values.json === true;
  if (action === undefined || !ACTIONS.has(action)) {
    io.stderr(`Specify a plan action.\n${planUsage}\n`);
    return 1;
  }
  // A linked worktree's plan items belong to its registered repository, where its hooks read them.
  const roots = await resolveCommandRoots(resolve(io.cwd, values.root ?? "."));
  const repositoryRoot = roots.executionRoot;
  const storage = await openProjectStorage(roots.evidenceRoot);
  try {
    if (action === "list") {
      const ledger = readPlanLedger(storage);
      const lines = planLedgerLines(ledger, { open: values.all !== true });
      io.stdout(
        json
          ? `${JSON.stringify({ schemaVersion: 1, items: lines.map(({ item, depth }) => ({ ...itemJson(item), depth })) }, null, 2)}\n`
          : lines.length === 0
            ? "No open plan items.\n"
            : `${formatPlanLedgerLines(lines)}\n`,
      );
      return 0;
    }
    if (action === "add") {
      if (parsed.positionals.length !== 1 || values.title === undefined)
        throw new Error(`plan add takes --title and no item id.\n${planUsage}`);
      const kind = (values.kind ?? "plan") as PlanItemKind;
      if (!KINDS.has(kind)) throw new Error(`--kind is one of ${[...KINDS].join(", ")}.`);
      const item = capturePlanItem(storage, {
        parentId: values.parent ?? null,
        kind,
        title: values.title,
        source: {
          origin: "agent_command",
          provider: null,
          sessionDigest: null,
          transcriptOffset: null,
        },
      });
      return report(io, json, item, "Captured");
    }
    if (itemId === undefined || parsed.positionals.length !== 2)
      throw new Error(`plan ${action} takes one item id.\n${planUsage}`);
    if (action === "start")
      return report(io, json, updatePlanItem(storage, { itemId, state: "in_progress" }), "Started");
    if (action === "move") {
      if ((values.parent === undefined) === (values["root-level"] !== true))
        throw new Error("plan move takes exactly one of --parent or --root-level.");
      return report(
        io,
        json,
        updatePlanItem(storage, { itemId, parentId: values.parent ?? null }),
        "Moved",
      );
    }
    if (values.reason === undefined) throw new Error(`plan ${action} takes --reason.`);
    if (action === "done") {
      const evidence: PlanItemEvidence[] = [
        ...(values.commit ?? []).map((ref) => ({
          kind: "commit" as const,
          ref,
          branch: values.branch ?? null,
        })),
        ...(values.release ?? []).map((ref) => ({ kind: "release" as const, ref, branch: null })),
        ...(values.event ?? []).map((ref) => ({ kind: "event" as const, ref, branch: null })),
      ];
      return report(
        io,
        json,
        await closePlanItem(storage, {
          repositoryRoot,
          itemId,
          state: "done",
          reason: values.reason,
          evidence,
        }),
        "Closed",
      );
    }
    if (action === "supersede" && values.by === undefined)
      throw new Error("plan supersede takes --by <item-id>.");
    return report(
      io,
      json,
      await closePlanItem(storage, {
        repositoryRoot,
        itemId,
        state: action === "cancel" ? "cancelled" : "superseded",
        reason: values.reason,
        supersededBy: values.by ?? null,
      }),
      "Closed",
    );
  } catch (error) {
    writeCommandError(io, error, { json });
    return 1;
  } finally {
    await storage.close();
  }
}

function report(io: CliIo, json: boolean, item: PlanItem, verb: string): number {
  io.stdout(
    json
      ? `${JSON.stringify({ schemaVersion: 1, item: itemJson(item) }, null, 2)}\n`
      : `${verb} ${item.itemId} [${item.state}] ${item.title}\n`,
  );
  return 0;
}
