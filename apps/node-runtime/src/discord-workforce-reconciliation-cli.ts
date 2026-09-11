import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { reconcileDiscordWorkforce } from "./discord-workforce-reconciliation.js";

export async function runDiscordWorkforceReconciliationCli(
  args: readonly string[],
  ports: { cwd: string; stdout(message: string): void },
): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      config: { type: "string" },
      "parent-integration": { type: "string" },
      conversation: { type: "string" },
    },
  });
  if (
    parsed.values.config === undefined ||
    parsed.values["parent-integration"] === undefined ||
    parsed.values.conversation === undefined
  ) {
    throw new Error(
      "Usage: lervo-node discord-workforce-reconcile --config <config.json> --parent-integration <integration-id> --conversation <conversation-id>",
    );
  }
  const configPath = resolve(ports.cwd, parsed.values.config);
  const result = await reconcileDiscordWorkforce({
    repositoryRoot: resolve(ports.cwd, "."),
    configPath,
    parentIntegrationId: parsed.values["parent-integration"],
    conversationId: parsed.values.conversation,
  });
  ports.stdout(`${JSON.stringify({ schemaVersion: 1, status: "reconciled", ...result })}\n`);
  return 0;
}
