import { resolve } from "node:path";
import { loadNodeRuntimeConfig } from "./config.js";
import { resolveRecoveryBinding } from "./supervision-recovery-binding.js";
import { recoverInterruptedPreTurn } from "./supervision-pre-turn-recovery.js";

/** One explicit repair command; never invoked by the background owner loop. */
export async function runPreTurnRecoveryCli(
  args: readonly string[],
  ports: { cwd: string; stdout(message: string): void; stderr(message: string): void },
): Promise<number> {
  if (args.length !== 4 || args[0] !== "--config" || args[2] !== "--run-id") {
    ports.stderr(
      "Usage: lervo-node recover-pre-turn --config <node-config.json> --run-id <run-id>\n",
    );
    return 1;
  }
  try {
    const config = await loadNodeRuntimeConfig(resolve(ports.cwd, args[1]!));
    if (config.outcomeSupervision === undefined)
      throw new Error("The installed Node has no outcome supervision binding.");
    const result = await recoverInterruptedPreTurn({
      repositoryRoot: config.repositoryRoot,
      binding: await resolveRecoveryBinding(config.repositoryRoot, config.outcomeSupervision),
      runId: args[3]!,
    });
    ports.stdout(
      JSON.stringify({ schemaVersion: 1, component: "pre_turn_recovery", ...result }) + "\n",
    );
    return 0;
  } catch (error) {
    ports.stderr(
      `Pre-turn recovery failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    return 1;
  }
}
