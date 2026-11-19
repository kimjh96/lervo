import { refreshRelationWeb, type RelationWebRefresh } from "@lervo/repository-knowledge";

import { cliCommandCatalog } from "./cli-command-catalog.js";

/**
 * ADR-0562: refreshes the relation web with the running CLI's command catalog. The resident calls
 * this when it starts on a checkout, because the document lifecycle reads the stored catalog to
 * find removed commands and only the CLI knows its own usage text.
 */
export async function refreshRelationWebWithCatalog(
  root: string,
  now: Date,
): Promise<RelationWebRefresh> {
  // The usage text lives in the entrypoint, which is fully loaded once a command runs.
  const { cliUsage } = await import("./main.js");
  return refreshRelationWeb(root, { commands: cliCommandCatalog(cliUsage), now });
}
