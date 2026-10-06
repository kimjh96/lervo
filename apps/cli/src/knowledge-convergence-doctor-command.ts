import { realpath } from "node:fs/promises";

import { loadProjectManifest } from "@lervo/project";

import { formatContinuityDoctor } from "./knowledge-convergence-doctor-format.js";
import { inspectContinuityDoctor } from "./knowledge-convergence-doctor-inspection.js";
import type { CliIo } from "./types.js";

const usage = "Usage: lervo knowledge convergence doctor [--json]\n";

/**
 * `lervo knowledge convergence doctor`: read-only continuity report for every repository on
 * this host. Exit 0 only when nothing needs attention or an owner decision.
 */
export async function runKnowledgeConvergenceDoctorCommand(
  args: readonly string[],
  io: CliIo,
): Promise<number> {
  if (args.some((arg) => arg !== "--json")) {
    io.stderr(usage);
    return 1;
  }
  try {
    const current = await loadProjectManifest(io.cwd)
      .then(() => realpath(io.cwd))
      .catch(() => null);
    const report = await inspectContinuityDoctor({ currentRoot: current });
    io.stdout(
      args.includes("--json")
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatContinuityDoctor(report),
    );
    return report.status === "healthy" ? 0 : 1;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    io.stderr(
      `${typeof code === "string" && /^[a-z][a-z0-9_]{0,127}$/u.test(code) ? code : "knowledge_continuity_doctor_failed"}\n`,
    );
    return 1;
  }
}
