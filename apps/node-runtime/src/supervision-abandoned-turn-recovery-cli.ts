import { resolve } from "node:path";
import { loadNodeRuntimeConfig } from "./config.js";
import { resolveRecoveryBinding } from "./supervision-recovery-binding.js";
import { recoverAbandonedTurn } from "./supervision-abandoned-turn-recovery.js";

/** One explicit repair command; never invoked by the background owner loop. */
export async function runAbandonedTurnRecoveryCli(
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
      "Usage: lervo-node recover-abandoned-turn --config <node-config.json> --run-id <run-id> --unit <systemd-unit>\n",
    );
    return 1;
  }
  try {
    const config = await loadNodeRuntimeConfig(resolve(ports.cwd, args[1]!));
    if (config.outcomeSupervision === undefined)
      throw new Error("The installed Node has no outcome supervision binding.");
    const result = await recoverAbandonedTurn({
      repositoryRoot: config.repositoryRoot,
      binding: await resolveRecoveryBinding(config.repositoryRoot, config.outcomeSupervision),
      runId: args[3]!,
      unit: args[5]!,
    });
    ports.stdout(
      JSON.stringify({ schemaVersion: 1, component: "abandoned_turn_recovery", ...result }) + "\n",
    );
    return 0;
  } catch (error) {
    ports.stderr(
      `Abandoned turn recovery failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    return 1;
  }
}
