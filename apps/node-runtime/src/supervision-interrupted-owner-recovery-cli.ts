import { resolve } from "node:path";
import { openProjectStorage } from "@lervo/project-storage";

import { loadNodeRuntimeConfig } from "./config.js";
import { reconcileInterruptedOwnerReasoning } from "./supervision-interrupted-owner-recovery.js";
import { resolveStandingSupervisionBinding } from "./supervision-standing.js";

/** Explicit repair after compatible readers are installed; never background-replays provider work. */
export async function runInterruptedOwnerRecoveryCli(
  args: readonly string[],
  ports: { cwd: string; stdout(message: string): void; stderr(message: string): void },
): Promise<number> {
  if (
    args.length !== 6 ||
    args[0] !== "--config" ||
    args[2] !== "--run-id" ||
    args[4] !== "--unit"
  ) {
    ports.stderr(
      "Usage: lervo-node reconcile-interrupted-owner --config <node-config.json> --run-id <run-id> --unit <systemd-unit>\n",
    );
    return 1;
  }
  try {
    const config = await loadNodeRuntimeConfig(resolve(ports.cwd, args[1]!));
    if (config.outcomeSupervision === undefined)
      throw new Error("The installed Node has no outcome supervision binding.");
    let binding = config.outcomeSupervision.binding;
    if (config.outcomeSupervision.standing) {
      const storage = await openProjectStorage(config.repositoryRoot);
      try {
        binding = (
          await resolveStandingSupervisionBinding(storage, binding, () => new Date().toISOString())
        ).binding;
      } finally {
        await storage.close();
      }
    }
    const result = await reconcileInterruptedOwnerReasoning({
      repositoryRoot: config.repositoryRoot,
      binding,
      runId: args[3]!,
      unit: args[5]!,
    });
    ports.stdout(
      JSON.stringify({ schemaVersion: 1, component: "interrupted_owner_recovery", ...result }) +
        "\n",
    );
    return 0;
  } catch (error) {
    ports.stderr(
      `Interrupted owner recovery failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    return 1;
  }
}
