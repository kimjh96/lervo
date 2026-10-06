import { openReadOnlyProjectStorage } from "@lervo/project-storage";
import { inspectAutonomousKnowledgeStatus } from "@lervo/repository-knowledge-runtime";
import type { CliIo } from "./types.js";
import { runKnowledgeConvergenceDelegationCommand } from "./knowledge-convergence-delegation-command.js";
import { runKnowledgeConvergenceOwnerCommand } from "./knowledge-convergence-owner-command.js";
import { runKnowledgeConvergenceDoctorCommand } from "./knowledge-convergence-doctor-command.js";
import { runKnowledgeProviderProbeCommand } from "./knowledge-provider-probe-command.js";

/** Baseline migration rehearsal and status are read-only and grant no semantic approval. */
export async function runKnowledgeConvergenceCommand(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  if (args[0] === "provider-probe") return runKnowledgeProviderProbeCommand(args.slice(1), io);
  if (args[0] === "delegation") return runKnowledgeConvergenceDelegationCommand(args.slice(1), io);
  if (args[0] === "owner") return runKnowledgeConvergenceOwnerCommand(args.slice(1), io);
  if (args[0] === "doctor") return runKnowledgeConvergenceDoctorCommand(args.slice(1), io);
  if (
    !["status", "inspect"].includes(args[0] ?? "") ||
    args.slice(1).some((arg) => arg !== "--json")
  ) {
    io.stderr(
      "Usage: lervo knowledge convergence <status|inspect|doctor|owner|delegation|provider-probe> [--json]\n",
    );
    return 1;
  }
  try {
    const storage = await openReadOnlyProjectStorage(io.cwd);
    try {
      const status = await inspectAutonomousKnowledgeStatus(storage);
      io.stdout(`${JSON.stringify(status, null, args.includes("--json") ? 2 : undefined)}\n`);
      return 0;
    } finally {
      await storage.close();
    }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    io.stderr(
      `${typeof code === "string" && /^[a-z][a-z0-9_]{0,127}$/u.test(code) ? code : "knowledge_inspection_failed"}\n`,
    );
    return 1;
  }
}
