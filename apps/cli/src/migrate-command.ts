import type { CliIo, CliServices } from "./types.js";
import { runKnowledgeMigration } from "./knowledge-command.js";

export const migrateUsage =
  "  lervo migrate knowledge [--root <path>] [--integration-head] [--continuation-source <relative-markdown-path>] [--provider <codex|claude>|--candidate <candidate-id>] [--model <model>] [--executable <path>] [--timeout-ms <ms>] [--apply <plan-id> [--approve-item <terminal-operation-id>=<approval-hash>]] [--json]";

export async function runMigrateCommand(
  args: string[],
  io: CliIo,
  services: Partial<Pick<CliServices, "crossCheckPlan">> = {},
): Promise<number> {
  if (args[0] === "knowledge") {
    return runKnowledgeMigration({ args: args.slice(1), io, mode: "migrate", services });
  }
  io.stderr(`Specify a supported migration type.\n${migrateUsage}\n`);
  return 1;
}
