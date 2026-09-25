import { resolve } from "node:path";

import { loadNodeRuntimeConfig } from "./config.js";
import { reconcileInterruptedOwnerReasoning } from "./supervision-interrupted-owner-recovery.js";
import { resolveRecoveryBinding } from "./supervision-recovery-binding.js";

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
    const binding = await resolveRecoveryBinding(config.repositoryRoot, config.outcomeSupervision);
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
