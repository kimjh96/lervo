import { startHostKnowledgeResidents } from "./knowledge-host-residents.js";
import {
  applyKnowledgeHostServiceEnvironment,
  readKnowledgeHostServiceConfig,
} from "./knowledge-host-service-config.js";
import { knowledgeWorkerFailureLine } from "./knowledge-worker-failure.js";
import { untilTerminated } from "./process-termination.js";
import { knowledgeHostLogPath } from "./knowledge-host-service.js";
import { keepServiceLogBounded } from "./service-log-bound.js";
import { homedir } from "node:os";

const hostUsage =
  "Usage: lervo knowledge worker --watch --host [--provider <claude|codex>] [--config <absolute-path>]\n";

/**
 * `lervo knowledge worker --watch --host [--provider <claude|codex>] [--config <path>]`
 * (ADR-0469, ADR-0470): one resident per repository this host knows that no Node serves,
 * following registrations as they change. `--config` is the managed service's configuration; it
 * fixes the user state directory before any resident starts. Kept apart from the per-repository
 * worker so the generated terminal hook runtime does not bundle host service and activation code.
 */
export async function runHostKnowledgeResidentsCommand(
  args: readonly string[],
  io: { stdout(message: string): void; stderr(message: string): void },
): Promise<number> {
  const provider = args.includes("--provider") ? args[args.indexOf("--provider") + 1] : undefined;
  if (
    !args.includes("--watch") ||
    (provider !== undefined && provider !== "claude" && provider !== "codex")
  ) {
    io.stderr(hostUsage);
    return 1;
  }
  let fallback: "codex" | "claude" | null = provider ?? null;
  let launch: "service" | "manual" = "manual";
  if (args.includes("--config")) {
    const path = args[args.indexOf("--config") + 1];
    const reading = path === undefined ? null : await readKnowledgeHostServiceConfig(path);
    if (reading?.status !== "loaded") {
      io.stderr(`knowledge_host_config_invalid\n${hostUsage}`);
      return 1;
    }
    applyKnowledgeHostServiceEnvironment(reading.config);
    fallback = provider ?? reading.config.provider;
    launch = "service";
  }
  // ADR-0555: the launchd service appends output to a log file; the resident keeps it bounded.
  const stopLogBound =
    launch === "service" && process.platform === "darwin"
      ? keepServiceLogBounded(knowledgeHostLogPath(homedir()))
      : () => undefined;
  const stop = startHostKnowledgeResidents({
    provider: fallback,
    launch,
    // Resident context socket: only the service serves prompts, never a manual run.
    contextServer: launch === "service",
    onCycle: (root, result, cost) =>
      io.stdout(`${JSON.stringify({ repositoryRoot: root, result, cost })}\n`),
    onFailure: (root, error) => io.stderr(knowledgeWorkerFailureLine(error, root)),
  });
  try {
    await untilTerminated();
  } finally {
    stopLogBound();
    await stop();
  }
  return 0;
}
